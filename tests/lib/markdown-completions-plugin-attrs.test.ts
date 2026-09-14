import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { createMarkdownCompletions } from '@/components/dashboard/markdown-completions'

function complete(doc: string): CompletionResult | null {
  const state = EditorState.create({ doc })
  const source = createMarkdownCompletions(() => [])
  return source(new CompletionContext(state, doc.length, true)) as CompletionResult | null
}

describe('plugin attribute completions', () => {
  it('suggests built-in attrs regardless of the owner part of src', () => {
    for (const owner of ['informatikgarten', 'eduadmin']) {
      const labels = complete(`<plugin src="${owner}/inclined-plane" `)?.options.map(o => o.label) ?? []
      expect(labels).toEqual(expect.arrayContaining(['scenario', 'alpha', 'mus', 'muk', 'src']))
    }
  })

  it('suggests scenario values', () => {
    const labels = complete('<plugin src="informatikgarten/inclined-plane" scenario="')?.options.map(o => o.label) ?? []
    expect(labels).toEqual(['endless', 'slide', 'sled', 'lift', 'pulley'])
  })

  it('keeps unknown plugins generic', () => {
    const labels = complete('<plugin src="someone/other" ')?.options.map(o => o.label) ?? []
    expect(labels).not.toContain('alpha')
  })
})
