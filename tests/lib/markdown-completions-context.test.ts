import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { createMarkdownCompletions } from '@/components/dashboard/markdown-completions'

function labels(doc: string, explicit = false): string[] | null {
  const state = EditorState.create({ doc })
  const source = createMarkdownCompletions(() => [])
  const result = source(new CompletionContext(state, doc.length, explicit)) as CompletionResult | null
  return result ? result.options.map(o => o.label) : null
}

describe('tag-scoped attribute values', () => {
  it('offers cta typography values', () => {
    expect(labels('<cta href="/" font="')).toEqual(['heading', 'body'])
    expect(labels('<cta href="/" weight="')).toContain('bold')
  })

  it('uses flex alignment words, not text alignment', () => {
    expect(labels('<flex align="')).toEqual(['start', 'center', 'end', 'stretch', 'baseline'])
    expect(labels('<img align="')).toEqual(['left', 'center', 'right'])
  })

  it('treats answer feedback as free text but question feedback as a mode', () => {
    expect(labels('<answer feedback="')).toBeNull()
    expect(labels('<question feedback="')).toEqual(['check', 'instant', 'none'])
  })

  it('completes hyphenated attribute names', () => {
    expect(labels('<geogebra material-')).toContain('material-id')
  })
})

describe('code fences', () => {
  it('suggests fence kinds after ```', () => {
    expect(labels('```pyt')).toEqual(expect.arrayContaining(['python editor', 'python-check', 'plot', 'mermaid']))
  })

  it('suggests editor flags, SQL-specific ones only for sql', () => {
    const sql = labels('```sql editor ')
    expect(sql).toEqual(expect.arrayContaining(['db', 'solution', 'id', 'height']))
    expect(sql).not.toContain('editor')
    expect(labels('```python editor ')).not.toContain('db')
  })

  it('skips flags already on the line', () => {
    expect(labels('```python editor id="a" ')).not.toContain('id')
  })

  it('suggests python editor ids for python-check for=""', () => {
    const doc = '```python editor id="fizzbuzz"\npass\n```\n\n```python-check for="'
    expect(labels(doc)).toEqual(['fizzbuzz'])
  })

  it('suggests plot settings at line start and options after a comma', () => {
    expect(labels('```plot\ngr')).toContain('grid')
    expect(labels('```plot\nx: -4..4\nf(x) = x^2, ')).toEqual(expect.arrayContaining(['red', 'dashed', 'label=""']))
  })

  it('stays quiet inside ordinary code blocks', () => {
    expect(labels('```python\nx = <cta')).toBeNull()
  })

  it('resumes tag completion after a closed fence', () => {
    expect(labels('```python\nx = 1\n```\n\n<ct')).toContain('cta')
  })
})

describe('Ctrl+Space on plain text', () => {
  it('offers block snippets and tags at the start of a line', () => {
    const all = labels('Text\n\n', true)
    expect(all).toEqual(expect.arrayContaining(['```python editor', '```plot', '<cta>', '<phet>']))
  })

  it('offers only tags mid-sentence', () => {
    const all = labels('Ein Satz ', true)
    expect(all).toContain('<nobr>')
    expect(all).not.toContain('```plot')
  })

  it('does nothing while typing plain text', () => {
    expect(labels('Ein Satz ')).toBeNull()
  })
})
