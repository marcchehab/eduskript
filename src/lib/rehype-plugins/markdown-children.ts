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
  'answer',
  'banner',
])

/**
 * Containers whose content is INLINE: re-parsed in document order via
 * reparseOrdered, and a lone paragraph is unwrapped so `<answer>` text keeps
 * sitting on the radio row and `<banner>` stays a single bar.
 */
const INLINE_CONTENT_ELEMENTS = new Set(['answer', 'banner'])

/**
 * `<question>` needs its own path. Its literal text child is the prompt, and
 * splicing the re-parsed prompt in as a plain element would break the quiz:
 * components/markdown/quiz.tsx indexes answers by DENSE element position, so an
 * extra `<p>` sibling would be counted as an answer option and shift every
 * stored `selected` index. So the prompt is wrapped in `<question-prompt>`,
 * inserted first, and the quiz component renders that separately and skips it
 * when indexing answers.
 */
const PROMPT_WRAPPER = 'question-prompt'

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
    // Inline containers keep element order (remark may already have parsed a
    // link or formula when the tag was written inline) and end up with inline
    // nodes rather than a paragraph.
    if (INLINE_CONTENT_ELEMENTS.has(node.tagName.toLowerCase())) {
      node.children = await reparseOrdered(node.children)
      return
    }

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
      // Strip positions: these come from the nested parse's OWN coordinate
      // space (the inner string), not the outer document. Left in place,
      // rehypeSourceLine would map them through the outer lineMap to wrong
      // editor lines. Dropping them makes source-line skip this content (clicks
      // fall back to the nearest positioned ancestor) — acceptable for
      // re-parsed inner content.
      const parsed = hast.children as ElementContent[]
      parsed.forEach(stripPositions)
      node.children = node.children.filter((c) => c.type !== 'text')
      node.children.push(...parsed)
    }
  }

  /**
   * Re-parse a mixed child list IN ORDER: runs of literal text become markdown
   * (a lone paragraph is unwrapped to its inline nodes), already-parsed
   * elements pass through untouched. Word gaps between a text run and its
   * element neighbours survive as single spaces.
   *
   * Needed wherever remark may already have parsed part of the content: when
   * the author breaks an opening tag over several lines (CommonMark stops
   * treating the block as raw HTML) or writes the tag inline on one line
   * (`<banner>New: [Atlas](…)</banner>` — the link is an element by the time
   * we get here). Collecting text only would silently drop or reorder those
   * pieces: a prompt "Bei welchem $x$ …" lost its formula.
   */
  async function reparseOrdered(children: ElementContent[]): Promise<ElementContent[]> {
    const parts: ElementContent[] = []
    let pendingText = ''

    const space = (): void => {
      // Only between parts — a leading space would indent the content.
      if (parts.length > 0) parts.push({ type: 'text', value: ' ' })
    }

    const flushText = async (): Promise<void> => {
      const raw = pendingText
      pendingText = ''
      const text = raw.trim()

      // Whitespace-only run between two elements: markdown would swallow it, but
      // it is the word gap between "welchem" and the formula after it.
      if (!text) {
        if (raw) space()
        return
      }
      if (/^\s/.test(raw)) space()

      const hast = (await processor.run(processor.parse(text) as MdastRoot)) as Root
      let parsed = (hast.children ?? []) as ElementContent[]
      if (parsed.length === 1 && parsed[0].type === 'element' && parsed[0].tagName === 'p') {
        parsed = parsed[0].children as ElementContent[]
      }
      parsed.forEach(stripPositions)
      parts.push(...parsed)

      if (/\s$/.test(raw)) parts.push({ type: 'text', value: ' ' })
    }

    for (const child of children) {
      if (child.type === 'text') {
        pendingText += child.value
        continue
      }
      await flushText()
      parts.push(child)
    }
    await flushText()

    // Drop a trailing gap (the newline before the closing tag or the first answer).
    while (parts.length > 0) {
      const last = parts[parts.length - 1]
      if (last.type !== 'text' || last.value.trim() !== '') break
      parts.pop()
    }
    return parts
  }

  /**
   * Collect a `<question>`'s prompt into a `<question-prompt>` element placed
   * before the answers. Everything that is not an `<answer>` belongs to the
   * prompt — see reparseOrdered for why elements are kept, not just text.
   */
  async function reparseQuestionPrompt(node: Element): Promise<void> {
    const answers: ElementContent[] = []
    const rest: ElementContent[] = []
    for (const child of node.children) {
      if (child.type === 'element' && child.tagName.toLowerCase() === 'answer') answers.push(child)
      else rest.push(child)
    }

    const promptParts = await reparseOrdered(rest)
    if (promptParts.length === 0) return

    const prompt: Element = {
      type: 'element',
      tagName: PROMPT_WRAPPER,
      properties: {},
      children: promptParts,
    }
    node.children = [prompt, ...answers]
  }

  function stripPositions(node: any): void {
    if (!node || typeof node !== 'object') return
    delete node.position
    if (Array.isArray(node.children)) node.children.forEach(stripPositions)
  }

  // Walk the whole tree. `generation` only increments when we descend into
  // content we just produced by re-parsing (the safety-valve counter).
  // `node` is loosely typed: hast child unions include Doctype/Comment/Raw,
  // which don't all share a `children` field — we guard structurally instead.
  async function walk(node: any, generation: number): Promise<void> {
    const tag = node.type === 'element' ? node.tagName.toLowerCase() : ''
    const hasText =
      node.type === 'element' &&
      node.children.some((c: any) => c.type === 'text' && c.value.trim() !== '')

    if (tag === 'question' && hasText) {
      if (generation >= MAX_REPARSE_GENERATIONS) return
      await reparseQuestionPrompt(node)
      // Recurse so the answers' own text children re-parse too.
      for (const child of node.children) {
        await walk(child, generation + 1)
      }
      return
    }

    if (MARKDOWN_CHILDREN_ELEMENTS.has(tag) && hasText) {
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
