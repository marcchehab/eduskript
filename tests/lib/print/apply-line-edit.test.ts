import { describe, expect, it } from 'vitest'
import { applyLineRangeEdit } from '@/lib/print/apply-line-edit'
import { lineRangeEdit, setSpacerPrintHeight } from '@/lib/print/print-edits'
import { publicContent } from '@/lib/teacher-content'

const PAGE = [
  '# Seite',
  '',
  'Aufgabe 1',
  '',
  '<spacer pattern="lines" height="150" />',
  '',
  '<solution teacher title="Lösung 1">',
  '',
  'Geheim: $x=2$',
  '',
  '</solution>',
  '',
  'Ende',
].join('\n')

describe('applyLineRangeEdit', () => {
  it('applies an edit made on the public markdown next to a teacher solution', () => {
    const pub = publicContent(PAGE)
    const after = setSpacerPrintHeight(pub, 5, 5, '4cm')!
    const edit = lineRangeEdit(pub, after)
    // The context line is the stripped solution opener: differs from the DB.
    expect(edit.old).not.toBe(PAGE.split('\n').slice(edit.line - 1, edit.line - 1 + edit.old.split('\n').length).join('\n'))

    const next = applyLineRangeEdit(PAGE, edit.old, edit.new, edit.line)
    expect(next).toBe(PAGE.replace('height="150" />', 'height="150" print-height="4cm" />'))
    expect(next).toContain('<solution teacher title="Lösung 1">')
    expect(next).toContain('Geheim: $x=2$')
  })

  it('still applies edits whose old text matches the DB content', () => {
    const after = setSpacerPrintHeight(PAGE, 5, 5, '3cm')!
    const edit = lineRangeEdit(PAGE, after)
    expect(applyLineRangeEdit(PAGE, edit.old, edit.new, edit.line)).toBe(after)
  })

  it('rejects when the lines changed meanwhile', () => {
    const edit = { old: 'Aufgabe 1\n\n<spacer pattern="lines" height="999" />', new: 'x', line: 3 }
    expect(applyLineRangeEdit(PAGE, edit.old, edit.new, edit.line)).toBeNull()
  })

  it('rejects a change to a stripped line itself', () => {
    const pub = publicContent(PAGE).split('\n')
    const opener = pub[6]
    const edit = { old: opener, new: opener.replace('<solution', '<solution data-x="1"'), line: 7 }
    expect(applyLineRangeEdit(PAGE, edit.old, edit.new, edit.line)).toBeNull()
  })

  it('rejects ranges outside the content', () => {
    expect(applyLineRangeEdit(PAGE, 'Ende\nmehr', 'x', 13)).toBeNull()
  })
})
