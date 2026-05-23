import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodeEditor from '@/lib/remark-plugins/code-editor'

// Find first node matching predicate in an mdast tree.
function findNode(node: any, predicate: (n: any) => boolean): any {
  if (predicate(node)) return node
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNode(child, predicate)
      if (found) return found
    }
  }
  return undefined
}

function getHtmlAttr(html: string, attr: string): string | undefined {
  const match = html.match(new RegExp(`${attr}="([^"]*)"`, 'i'))
  return match?.[1]
}

// Reverse escapeHtml from the remark plugin so we can JSON.parse the stages.
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function compile(markdown: string): string {
  const processor = unified().use(remarkParse).use(remarkCodeEditor)
  const tree = processor.parse(markdown)
  processor.runSync(tree)
  const htmlNode = findNode(
    tree,
    (n: any) => n.type === 'html' && typeof n.value === 'string' && n.value.includes('<code-editor'),
  )
  return htmlNode?.value ?? ''
}

const BT = '```'

describe('remarkCodeEditor — staged python-check', () => {
  it('collects multiple python-check blocks into ordered stages', () => {
    const md = [
      `${BT}python editor id="ean"`,
      'print(1)',
      BT,
      '',
      `${BT}python-check for="ean" gate-at="1:30" label="parse digits"`,
      'assert parsed',
      BT,
      '',
      `${BT}python-check for="ean" gate-at="2:30"`,
      'assert checksum',
      BT,
    ].join('\n')

    const html = compile(md)
    const raw = getHtmlAttr(html, 'data-check-stages')
    expect(raw).toBeDefined()

    const stages = JSON.parse(unescapeHtml(raw as string)) as Array<{
      code: string
      gateAt?: string
      label?: string
    }>
    expect(stages).toHaveLength(2)
    expect(stages[0].gateAt).toBe('1:30')
    expect(stages[0].label).toBe('parse digits')
    expect(stages[0].code).toContain('assert parsed')
    expect(stages[1].gateAt).toBe('2:30')
    expect(stages[1].code).toContain('assert checksum')

    // python-check blocks are consumed (never rendered)
    expect(html).not.toContain('python-check')
  })

  it('still emits data-check-code for the first stage (backward compatible)', () => {
    const md = [
      `${BT}python editor id="solo"`,
      'print(1)',
      BT,
      '',
      `${BT}python-check for="solo"`,
      'assert only',
      BT,
    ].join('\n')

    const html = compile(md)
    expect(getHtmlAttr(html, 'data-check-code')).toContain('assert only')
    const stages = JSON.parse(unescapeHtml(getHtmlAttr(html, 'data-check-stages') as string))
    expect(stages).toHaveLength(1)
  })
})
