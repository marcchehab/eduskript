import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkCodeCopy } from '@/lib/remark-plugins/code-copy'
import type { Root, Code } from 'mdast'

function dataCopyFor(markdown: string): unknown {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  unified().use(remarkCodeCopy).runSync(tree)
  let result: unknown
  const walk = (n: { type: string; data?: { hProperties?: Record<string, unknown> }; children?: unknown[] }) => {
    if (n.type === 'code') result = (n as Code).data?.hProperties?.dataCopy
    if (Array.isArray(n.children)) n.children.forEach((c) => walk(c as never))
  }
  walk(tree as never)
  return result
}

describe('remarkCodeCopy', () => {
  it('copy=false → dataCopy "false"', () => {
    expect(dataCopyFor('```python copy=false\nx\n```')).toBe('false')
  })
  it('no-copy → dataCopy "false"', () => {
    expect(dataCopyFor('```python no-copy\nx\n```')).toBe('false')
  })
  it('bare copy → dataCopy "true"', () => {
    expect(dataCopyFor('```python copy\nx\n```')).toBe('true')
  })
  it('copy=true → dataCopy "true"', () => {
    expect(dataCopyFor('```python copy=true\nx\n```')).toBe('true')
  })
  it('no directive → no dataCopy', () => {
    expect(dataCopyFor('```python\nx\n```')).toBeUndefined()
  })
  it('unrelated meta (e.g. editor) → no dataCopy', () => {
    expect(dataCopyFor('```python editor\nx\n```')).toBeUndefined()
  })
})
