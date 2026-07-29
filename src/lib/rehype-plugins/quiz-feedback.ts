import type { Root, Element, ElementContent } from 'hast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import type { Root as MdastRoot } from 'mdast'
import { remarkPlugins } from '../markdown-plugins'

/**
 * `feedback="…"` is an HTML attribute, so its markdown and `$math$` never reach
 * the pipeline — authors were getting literal dollar signs and asterisks in the
 * hint under a wrong answer.
 *
 * This plugin parses each `feedback` attribute and hangs the result on the
 * element as an `<answer-feedback>` child. Two consequences worth knowing:
 *
 *   - The math lands in the tree BEFORE the main `rehypeKatex` runs, so KaTeX
 *     renders it like any other formula on the page. That is why the feedback
 *     is not serialized to an HTML string and injected — no innerHTML anywhere.
 *   - `<answer-feedback>` is a child of `<answer>`, never of `<question>`, so
 *     the dense answer indexing in components/markdown/quiz.tsx is untouched.
 *     quiz.tsx pulls the node out and keeps the rest as the option label.
 *
 * The plain `feedback` attribute stays in place as a fallback for anything that
 * renders a question outside this pipeline.
 */
export function rehypeQuizFeedback() {
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)

  async function attach(node: Element): Promise<void> {
    const feedback = node.properties?.feedback
    if (typeof feedback !== 'string' || !feedback.trim()) return

    const hast = (await processor.run(processor.parse(feedback.trim()) as MdastRoot)) as Root
    let children = (hast.children ?? []) as ElementContent[]
    if (children.length === 0) return
    // Unwrap the single paragraph markdown wraps a one-liner in — the feedback
    // renders inline inside its own box.
    if (children.length === 1 && children[0].type === 'element' && children[0].tagName === 'p') {
      children = children[0].children as ElementContent[]
    }
    stripPositions(children)

    node.children = [
      { type: 'element', tagName: 'answer-feedback', properties: {}, children },
      ...node.children,
    ]
  }

  // Positions come from the nested parse's own coordinate space; left in place
  // rehypeSourceLine would map them to the wrong editor lines.
  function stripPositions(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(stripPositions)
      return
    }
    const record = node as { position?: unknown; children?: unknown }
    delete record.position
    if (Array.isArray(record.children)) record.children.forEach(stripPositions)
  }

  async function walk(node: unknown): Promise<void> {
    if (!node || typeof node !== 'object') return
    const element = node as Element
    if (element.type === 'element' && element.tagName === 'answer') {
      await attach(element)
      return
    }
    const children = (node as { children?: unknown[] }).children
    if (Array.isArray(children)) {
      for (const child of children) await walk(child)
    }
  }

  return async (tree: Root) => {
    await walk(tree)
  }
}
