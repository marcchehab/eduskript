/**
 * Tabs in Python indentation become spaces (src/lib/code-editor/indent-tabs.ts).
 */
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { expandIndentTabs, pythonIndentTabs } from '@/lib/code-editor/indent-tabs'

describe('expandIndentTabs', () => {
  it('expands indentation tabs to the next multiple of 4, leaves other tabs', () => {
    expect(expandIndentTabs('if x:\n\tprint("a\\tb")\n\t\tpass')).toBe('if x:\n    print("a\\tb")\n        pass')
    expect(expandIndentTabs('  \tx')).toBe('    x') // 2 spaces + tab → column 4
    expect(expandIndentTabs('x = "\t"')).toBe('x = "\t"') // tab after code stays
  })
})

describe('pythonIndentTabs', () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: [pythonIndentTabs(4)] })

  it('expands tabs pasted into the indentation in the same transaction', () => {
    const s = state('for i in x:\n')
    const next = s.update({ changes: { from: s.doc.length, insert: '\tprint(i)\n\tif i:\n\t\tpass' }, userEvent: 'input.paste' }).state
    expect(next.doc.toString()).toBe('for i in x:\n    print(i)\n    if i:\n        pass')
  })

  it('expands a full-document replace (loading starter code / a saved answer)', () => {
    const s = state('')
    const next = s.update({ changes: { from: 0, insert: 'def f():\n\treturn 1' } }).state
    expect(next.doc.toString()).toBe('def f():\n    return 1')
  })

  it('leaves transactions without tabs and tabs after code alone', () => {
    const s = state('x = 1')
    expect(s.update({ changes: { from: 5, insert: ' # a\tb' } }).state.doc.toString()).toBe('x = 1 # a\tb')
  })
})
