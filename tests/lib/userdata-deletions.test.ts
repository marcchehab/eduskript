import { describe, it, expect } from 'vitest'
import {
  snapsAdapter,
  spacersAdapter,
  stickyNotesAdapter,
  textHighlightsAdapter,
  recordDeletions,
  removedCollectionIds,
  MAX_DELETED_IDS,
  type SnapData,
} from '@/lib/userdata/adapters'

// Regression: deleted snaps kept coming back. The id-keyed adapters merged
// additively, so any stale copy (server row before the delete was pushed,
// another tab, another device) re-added the deleted item on the next merge.

const snap = (id: string): SnapData => ({ id, name: id, imageUrl: '', top: 0, left: 0, width: 1, height: 1 })

describe('collection merge with deletions', () => {
  it('does not resurrect a snap deleted locally', () => {
    const local = { snaps: [snap('b')], deletedIds: ['a'] }
    const remote = { snaps: [snap('a'), snap('b')] }
    expect(snapsAdapter.merge!(local, remote).snaps.map(s => s.id)).toEqual(['b'])
  })

  it('does not resurrect a snap deleted remotely', () => {
    const local = { snaps: [snap('a'), snap('b')] }
    const remote = { snaps: [snap('b')], deletedIds: ['a'] }
    const merged = snapsAdapter.merge!(local, remote)
    expect(merged.snaps.map(s => s.id)).toEqual(['b'])
    expect(merged.deletedIds).toEqual(['a'])
  })

  it('still keeps additions from both sides', () => {
    const merged = snapsAdapter.merge!({ snaps: [snap('a')] }, { snaps: [snap('b')] })
    expect(merged.snaps.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('applies to spacers, highlights and sticky notes too', () => {
    const spacer = { id: 'x' } as never
    expect(spacersAdapter.merge!({ spacers: [], deletedIds: ['x'] }, { spacers: [spacer] }).spacers).toEqual([])
    const hl = { id: 'x' } as never
    expect(textHighlightsAdapter.merge!({ highlights: [], deletedIds: ['x'] }, { highlights: [hl] }).highlights).toEqual([])
    const note = { id: 'x', updatedAt: 1 } as never
    expect(stickyNotesAdapter.merge!({ notes: [], deletedIds: ['x'] }, { notes: [note] }).notes).toEqual([])
  })

  it('sticky notes keep the newer version of a shared note', () => {
    const merged = stickyNotesAdapter.merge!(
      { notes: [{ id: 'n', updatedAt: 1, text: 'old' } as never] },
      { notes: [{ id: 'n', updatedAt: 2, text: 'new' } as never] },
    )
    expect((merged.notes[0] as unknown as { text: string }).text).toBe('new')
  })
})

describe('recordDeletions', () => {
  it('records ids removed by a write', () => {
    const previous = { snaps: [snap('a'), snap('b')] }
    const next = { snaps: [snap('b')] }
    const removed = removedCollectionIds('snaps', previous, next)
    expect(removed).toEqual(['a'])
    expect(recordDeletions('snaps', previous, next, removed).deletedIds).toEqual(['a'])
  })

  it('carries existing deletions across writes that omit them', () => {
    const existing = { snaps: [snap('b')], deletedIds: ['a'] }
    expect(recordDeletions('snaps', existing, { snaps: [snap('b'), snap('c')] }).deletedIds).toEqual(['a'])
  })

  it('drops an id from the list when it is re-added (undo)', () => {
    const existing = { snaps: [], deletedIds: ['a'] }
    expect(recordDeletions('snaps', existing, { snaps: [snap('a')] }).deletedIds ?? []).toEqual([])
  })

  it('caps the list, keeping the newest', () => {
    const many = Array.from({ length: MAX_DELETED_IDS + 5 }, (_, i) => `id${i}`)
    const result = recordDeletions('snaps', { snaps: [], deletedIds: many }, { snaps: [] }).deletedIds!
    expect(result).toHaveLength(MAX_DELETED_IDS)
    expect(result.at(-1)).toBe(`id${MAX_DELETED_IDS + 4}`)
  })

  it('leaves non-collection adapters untouched', () => {
    const data = { canvasData: '[]', headingOffsets: {} }
    expect(recordDeletions('annotations', null, data)).toBe(data)
  })
})
