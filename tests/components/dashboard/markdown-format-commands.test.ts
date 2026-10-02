import { describe, it, expect } from 'vitest'
import {
  toggleInline,
  toggleStrikethrough,
  insertLink,
  type FormatEdit,
} from '@/components/dashboard/markdown-format-commands'

// Apply an edit; return the new doc with the selection marked as [ and ] (or | when empty)
function apply(doc: string, e: FormatEdit): string {
  const out = doc.slice(0, e.changes.from) + e.changes.insert + doc.slice(e.changes.to)
  const { anchor, head } = e.selection
  const a = Math.min(anchor, head), b = Math.max(anchor, head)
  return a === b ? out.slice(0, a) + '|' + out.slice(a) : out.slice(0, a) + '[' + out.slice(a, b) + ']' + out.slice(b)
}

// Parse "foo [bar] baz" or "foo | baz" into doc + selection
function sel(marked: string): [string, number, number] {
  const pipe = marked.indexOf('|')
  if (pipe >= 0) return [marked.replace('|', ''), pipe, pipe]
  const a = marked.indexOf('[')
  const b = marked.indexOf(']') - 1
  return [marked.replace('[', '').replace(']', ''), a, b]
}

const bold = (m: string) => { const [d, f, t] = sel(m); return apply(d, toggleInline(d, f, t, 'strong')) }
const italic = (m: string) => { const [d, f, t] = sel(m); return apply(d, toggleInline(d, f, t, 'emphasis')) }
const code = (m: string) => { const [d, f, t] = sel(m); return apply(d, toggleInline(d, f, t, 'inlineCode')) }
const strike = (m: string) => { const [d, f, t] = sel(m); return apply(d, toggleStrikethrough(d, f, t)) }
const link = (m: string) => { const [d, f, t] = sel(m); return apply(d, insertLink(d, f, t)) }

describe('toggleInline', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(bold('a [word] b')).toBe('a **[word]** b')
    expect(italic('a [word] b')).toBe('a *[word]* b')
    expect(code('a [x = 1] b')).toBe('a `[x = 1]` b')
  })

  it('wraps the word under the cursor', () => {
    expect(bold('a wo|rd b')).toBe('a **[word]** b')
  })

  it('inserts empty markers with the cursor between them', () => {
    expect(bold('a | b')).toBe('a **|** b')
    expect(italic('|')).toBe('*|*')
  })

  it('removes freshly inserted empty markers on a second press', () => {
    expect(bold('a **|** b')).toBe('a | b')
    expect(italic('a *|* b')).toBe('a | b')
    // italic must not eat half of an empty bold pair
    expect(italic('a **|** b')).toBe('a ***|*** b')
  })

  it('removes existing formatting around the selection or cursor', () => {
    expect(bold('a **[word]** b')).toBe('a [word] b')
    expect(bold('a **wo|rd** b')).toBe('a wo|rd b')
    expect(italic('a *[word]* b')).toBe('a [word] b')
    expect(code('a ``x|y`` b')).toBe('a x|y b')
  })

  it('italic inside bold adds emphasis instead of stripping bold', () => {
    expect(italic('**[word]**')).toBe('***[word]***')
  })
})

describe('toggleStrikethrough', () => {
  it('wraps and unwraps', () => {
    expect(strike('a [word] b')).toBe('a ~~[word]~~ b')
    expect(strike('a ~~[word]~~ b')).toBe('a [word] b')
    expect(strike('a [~~word~~] b')).toBe('a [word] b')
  })
})

describe('insertLink', () => {
  it('uses the selection as label and selects the url placeholder', () => {
    expect(link('see [docs] here')).toBe('see [docs]([url]) here')
  })

  it('uses a selected URL as target, cursor in the label', () => {
    expect(link('[https://x.org]')).toBe('[|](https://x.org)')
  })

  it('inserts an empty link with no selection', () => {
    expect(link('a | b')).toBe('a [|](url) b')
  })
})
