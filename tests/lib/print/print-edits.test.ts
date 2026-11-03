import { describe, it, expect } from 'vitest'
import { insertPageBreak, lineRangeEdit, normalizePrintWidth, removePageBreak, setImagePrintWidth, setSpacerPrintHeight } from '@/lib/print/print-edits'

const img = (src: string, startLine: number, endLine?: number) => ({ kind: 'image' as const, src, startLine, endLine })
const drawing = (src: string, startLine: number, endLine?: number) => ({ kind: 'drawing' as const, src, startLine, endLine })

describe('setImagePrintWidth', () => {
  it('sets and removes print-width on <excali>', () => {
    const src = 'Text\n<excali src="forces" width="80%" />\n'
    const set = setImagePrintWidth(src, drawing('forces.excalidraw', 2), '50%')!
    expect(set).toBe('Text\n<excali src="forces" width="80%" print-width="50%" />\n')
    expect(setImagePrintWidth(set, drawing('forces.excalidraw', 2), '40%')).toBe('Text\n<excali src="forces" width="80%" print-width="40%" />\n')
    expect(setImagePrintWidth(set, drawing('forces.excalidraw', 2), null)).toBe(src)
  })

  it('uses data-print-width on <img>', () => {
    const src = '<img src="a.png" style="width: 70%" />'
    expect(setImagePrintWidth(src, img('a.png', 1), '30%')).toBe('<img src="a.png" style="width: 70%" data-print-width="30%" />')
  })

  it('handles > inside attribute values and single-quoted src', () => {
    expect(setImagePrintWidth('<img src="raw.png" alt="a > b" />', img('raw.png', 1), '40%')).toBe('<img src="raw.png" alt="a > b" data-print-width="40%" />')
    expect(setImagePrintWidth("<img alt='x > y' src='raw.png'>", img('raw.png', 1), '40%')).toBe("<img alt='x > y' src='raw.png' data-print-width=\"40%\">")
  })

  it('uses the {…} block on markdown images, keeping other attrs', () => {
    expect(setImagePrintWidth('![Bild](a.png)', img('a.png', 1), '60%')).toBe('![Bild](a.png){print-width=60%}')
    expect(setImagePrintWidth('![](a.png){invert;print-width=60%}', img('a.png', 1), '30%')).toBe('![](a.png){invert;print-width=30%}')
    expect(setImagePrintWidth('![](a.png){print-width=60%}', img('a.png', 1), null)).toBe('![](a.png)')
  })

  it('handles brackets in alt, all title forms, encoded spaces', () => {
    expect(setImagePrintWidth('![Alt [x] y](d.png)', img('d.png', 1), '50%')).toBe('![Alt [x] y](d.png){print-width=50%}')
    expect(setImagePrintWidth("![t](d.png 'single')", img('d.png', 1), '50%')).toBe("![t](d.png 'single'){print-width=50%}")
    expect(setImagePrintWidth('![t](d.png (paren))', img('d.png', 1), '50%')).toBe('![t](d.png (paren)){print-width=50%}')
    expect(setImagePrintWidth('![s](my pic.png)', img('my%20pic.png', 1), '50%')).toBe('![s](my pic.png){print-width=50%}')
  })

  it('markdown drawings', () => {
    expect(setImagePrintWidth('![](d.excalidraw)', drawing('d.excalidraw', 1), '50%')).toBe('![](d.excalidraw){print-width=50%}')
  })

  it('only searches the element lines; refuses ambiguity', () => {
    const src = '![](a.png)\n\n![](a.png)'
    expect(setImagePrintWidth(src, img('a.png', 3), '50%')).toBe('![](a.png)\n\n![](a.png){print-width=50%}')
    // An unparsable image on its line must not hit the same file further down.
    expect(setImagePrintWidth('[![x](d.png)][ref]\n\n![](d.png)', img('e.png', 1), '50%')).toBeNull()
    expect(setImagePrintWidth('![ref][d]\n\n![](d.png)', img('d.png', 1), '50%')).toBeNull()
    expect(setImagePrintWidth('![L](p.png) and ![R](p.png)', img('p.png', 1), '50%')).toBeNull()
    expect(setImagePrintWidth(src, img('b.png', 1), '50%')).toBeNull()
  })

  it('does not take an <img> for a drawing with the same bare name', () => {
    expect(setImagePrintWidth('<img src="d" />\n<excali src="d" />', drawing('d.excalidraw', 1, 2), '50%')).toBe('<img src="d" />\n<excali src="d" print-width="50%" />')
  })
})

describe('setSpacerPrintHeight', () => {
  it('sets, replaces and removes print-height', () => {
    const src = 'a\n<spacer id="s1" pattern="lines" height="200" />\nb'
    const set = setSpacerPrintHeight(src, 2, 2, '6.5cm')!
    expect(set).toBe('a\n<spacer id="s1" pattern="lines" height="200" print-height="6.5cm" />\nb')
    expect(setSpacerPrintHeight(set, 2, 2, '3cm')).toBe('a\n<spacer id="s1" pattern="lines" height="200" print-height="3cm" />\nb')
    expect(setSpacerPrintHeight(set, 2, 2, null)).toBe(src)
    expect(setSpacerPrintHeight(src, 1, 1, '3cm')).toBeNull()
  })
})

describe('page breaks', () => {
  it('inserts before a line as its own block', () => {
    expect(insertPageBreak('# A\n\nText\n\n## B', 5)).toBe('# A\n\nText\n\n<pagebreak />\n\n## B')
    expect(insertPageBreak('# A\nText', 2)).toBe('# A\n\n<pagebreak />\n\nText')
  })

  it('removes the break and one blank line', () => {
    expect(removePageBreak('# A\n\n<pagebreak />\n\n## B', 3)).toBe('# A\n\n## B')
    expect(removePageBreak('# A\n\nText', 3)).toBeNull()
  })

  it('insert then remove round-trips', () => {
    const src = '# A\n\nText\n\n## B'
    expect(removePageBreak(insertPageBreak(src, 5)!, 5)).toBe(src)
  })

  it('keeps CRLF line endings', () => {
    const src = 'a\r\n\r\nb'
    const ins = insertPageBreak(src, 3)!
    expect(ins).toBe('a\r\n\r\n<pagebreak />\r\n\r\nb')
    expect(removePageBreak(ins, 3)).toBe(src)
  })
})

/** Applies an edit the way /api/pages/[id]/replace does in line mode. */
function applyLineEdit(content: string, e: { old: string; new: string; line: number }) {
  const lines = content.split('\n')
  const n = e.old.split('\n').length
  expect(lines.slice(e.line - 1, e.line - 1 + n).join('\n')).toBe(e.old)
  return [...lines.slice(0, e.line - 1), e.new, ...lines.slice(e.line - 1 + n)].join('\n')
}

describe('lineRangeEdit', () => {
  it('covers the changed lines plus non-blank context', () => {
    expect(lineRangeEdit('a\nb\nc', 'a\nB\nc')).toEqual({ old: 'a\nb\nc', new: 'a\nB\nc', line: 1 })
    expect(lineRangeEdit('a\n\nb\nc', 'a\n\nX\nc')).toEqual({ old: 'a\n\nb\nc', new: 'a\n\nX\nc', line: 1 })
  })

  it('round-trips insertions and deletions, never with empty old/new', () => {
    const cases: [string, string][] = [
      ['a\nc', 'a\nb\nc'],
      ['a\nb\nc', 'a\nc'],
      ['# A\n\n<pagebreak />\n\n## B', '# A\n\n## B'],
      ['# A\n\n## B', '# A\n\n<pagebreak />\n\n## B'],
      ['x', '<pagebreak />\n\nx'],
      ['a\n\n', 'a'],
    ]
    for (const [before, after] of cases) {
      const e = lineRangeEdit(before, after)
      expect(e.old).not.toBe('')
      expect(applyLineEdit(before, e)).toBe(after)
    }
  })

  it('round-trips random edits', () => {
    const pool = ['a', 'b', '', '<pagebreak />', 'c']
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
    const make = () => Array.from({ length: 1 + rnd(6) }, () => pool[rnd(pool.length)]).join('\n')
    for (let i = 0; i < 3000; i++) {
      const before = make()
      const after = make()
      if (!before.trim()) continue
      expect(applyLineEdit(before, lineRangeEdit(before, after))).toBe(after)
    }
  })
})

it('normalizePrintWidth', () => {
  expect(normalizePrintWidth(59.6)).toBe('60%')
  expect(normalizePrintWidth('140')).toBe('100%')
  expect(normalizePrintWidth('x')).toBeNull()
})
