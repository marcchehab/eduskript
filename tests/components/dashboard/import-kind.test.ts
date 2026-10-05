import { describe, it, expect } from 'vitest'
import { importKindFor } from '@/components/dashboard/import-modal'

describe('importKindFor', () => {
  it('routes exports to the ZIP import and documents to the converter', () => {
    expect(importKindFor('Export.ZIP')).toBe('zip')
    for (const f of ['a.docx', 'b.doc', 'c.odt', 'd.rtf', 'e.PDF']) expect(importKindFor(f)).toBe('document')
  })

  it('rejects anything else', () => {
    for (const f of ['a.pages', 'b.txt', 'noext']) expect(importKindFor(f)).toBe('unsupported')
  })
})
