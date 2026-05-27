import type { Root, Element, Text, ElementContent } from 'hast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import type { Root as MdastRoot } from 'mdast'
import { remarkPlugins } from '../markdown-plugins'

/**
 * Custom container elements whose literal-text children should be (re-)parsed
 * as markdown.
 *
 * Why: authors write these as raw HTML. When they DON'T separate the inner
 * content with blank lines, CommonMark collapses the whole `<tag>…</tag>` into
 * one raw HTML block, so `rehype-raw` builds the right element tree but the
 * inner `**bold**`, lists, headings stay literal text. Re-parsing those text
 * children here makes the tags work with OR without blank lines (the blank-line
 * "requirement" was a workaround for this, not a feature).
 *
 * Only INNER content tags are listed — not the pure wrappers `<flex>`,
 * `<tabs-container>`, `<survey>`, whose direct text children are just
 * whitespace (their content lives in flex-item / tab-item / question). Listing
 * a wrapper would re-parse nothing and risk double-processing.
 *
 * `left`/`center`/`right` are listed too; this plugin runs BEFORE
 * `rehypeAlignTags` rewrites them to `<div>` (see markdown-compiler.ts order).
 */
const MARKDOWN_CHILDREN_ELEMENTS = new Set([
  'stickme',
  'tab-item',
  'flex-item',
  'fullwidth',
  'left',
  'center',
  'right',
])

/**
 * Safety valve on re-parse *chains* (a container whose re-parsed content yields
 * another container whose content must also re-parse, e.g. flex>flex-item>flex).
 * Termination is already guaranteed for finite input — each re-parse turns text
 * into elements monotonically — so this only caps pathological nesting depth.
 * It is NOT a tree-traversal depth limit: normal-depth walking is unbounded.
 */
const MAX_REPARSE_GENERATIONS = 8

/**
 * Rehype plugin to (re-)parse markdown inside specific custom container
 * elements. Runs after rehype-raw, so it sees a real element tree; it only
 * touches `text` children, so content already parsed via blank lines is left
 * alone — meaning blank-line and no-blank-line input converge to identical
 * output. Nested containers are resolved by walking the freshly-parsed subtree.
 */
export function rehypeMarkdownChildren() {
  // One processor for all re-parses. Includes our remark plugins so images,
  // excalidraw, callouts, quiz, etc. inside the container behave identically.
  // It does NOT re-run rehypeMarkdownChildren itself — the walk() recursion
  // below handles nested containers.
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)

  // Re-parse the combined literal-text children of `node` as markdown and
  // splice the parsed HAST in place of those text nodes. Element children
  // (already-parsed content) are preserved.
  async function reparseTextChildren(node: Element): Promise<void> {
    const textContent = node.children
      .filter((c): c is Text => c.type === 'text')
      .map((c) => c.value)
      .join('')
      .trim()

    if (!textContent) return

    const hast = (await processor.run(
      processor.parse(textContent) as MdastRoot
    )) as Root

    if (hast.children && hast.children.length > 0) {
      node.children = node.children.filter((c) => c.type !== 'text')
      node.children.push(...(hast.children as ElementContent[]))
    }
  }

  // Walk the whole tree. `generation` only increments when we descend into
  // content we just produced by re-parsing (the safety-valve counter).
  // `node` is loosely typed: hast child unions include Doctype/Comment/Raw,
  // which don't all share a `children` field — we guard structurally instead.
  async function walk(node: any, generation: number): Promise<void> {
    if (
      node.type === 'element' &&
      MARKDOWN_CHILDREN_ELEMENTS.has(node.tagName.toLowerCase()) &&
      node.children.some((c: any) => c.type === 'text' && c.value.trim() !== '')
    ) {
      if (generation >= MAX_REPARSE_GENERATIONS) return
      await reparseTextChildren(node)
      // Recurse into the freshly-parsed children at the next generation so
      // nested containers (e.g. <flex> inside a <flex-item>) also resolve.
      for (const child of node.children) {
        await walk(child, generation + 1)
      }
      return
    }

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        await walk(child, generation)
      }
    }
  }

  return async (tree: Root) => {
    await walk(tree, 0)
  }
}
