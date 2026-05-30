import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PENS,
  MIN_PENS,
  MAX_PENS,
  addPen,
  removePen,
  reorderPens,
  setPenColor,
  setPenSize,
  sanitizePens,
  pensFromLegacy,
  nextPenColor,
  PEN_PALETTE,
} from '@/lib/annotations/pens'

describe('pens — pure transforms', () => {
  it('addPen appends a pen with an unused palette colour', () => {
    const start = [{ id: 'a', color: PEN_PALETTE[0], size: 2, type: 'pen' as const }]
    const next = addPen(start)
    expect(next).toHaveLength(2)
    expect(next[1].color).not.toBe(PEN_PALETTE[0])
    expect(PEN_PALETTE).toContain(next[1].color)
    expect(next[1].id).not.toBe('a')
  })

  it('addPen is a no-op (same ref) at MAX_PENS', () => {
    const full = Array.from({ length: MAX_PENS }, (_, i) => ({ id: `p${i}`, color: '#000', size: 2, type: 'pen' as const }))
    expect(addPen(full)).toBe(full)
  })

  it('removePen removes by id but never below MIN_PENS', () => {
    const three = [
      { id: 'a', color: '#000', size: 2, type: 'pen' as const },
      { id: 'b', color: '#f00', size: 2, type: 'pen' as const },
      { id: 'c', color: '#00f', size: 2, type: 'pen' as const },
    ]
    expect(removePen(three, 'b').map((p) => p.id)).toEqual(['a', 'c'])
    const one = [three[0]]
    expect(removePen(one, 'a')).toBe(one) // clamp at MIN_PENS
    expect(MIN_PENS).toBe(1)
  })

  it('reorderPens reorders by id and keeps any unnamed pens', () => {
    const pens = [
      { id: 'a', color: '#000', size: 2, type: 'pen' as const },
      { id: 'b', color: '#f00', size: 2, type: 'pen' as const },
      { id: 'c', color: '#00f', size: 2, type: 'pen' as const },
    ]
    expect(reorderPens(pens, ['c', 'a', 'b']).map((p) => p.id)).toEqual(['c', 'a', 'b'])
    // unnamed id 'c' kept at the end
    expect(reorderPens(pens, ['b', 'a']).map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('setPenColor / setPenSize update only the matching pen', () => {
    const pens = [
      { id: 'a', color: '#000', size: 2, type: 'pen' as const },
      { id: 'b', color: '#f00', size: 2, type: 'pen' as const },
    ]
    expect(setPenColor(pens, 'b', '#0f0')).toEqual([
      { id: 'a', color: '#000', size: 2, type: 'pen' },
      { id: 'b', color: '#0f0', size: 2, type: 'pen' },
    ])
    expect(setPenSize(pens, 'a', 4.5)[0].size).toBe(4.5)
  })

  it('nextPenColor returns the first unused palette colour', () => {
    expect(nextPenColor([PEN_PALETTE[0]])).toBe(PEN_PALETTE[1])
    expect(nextPenColor([])).toBe(PEN_PALETTE[0])
  })
})

describe('pens — validation', () => {
  it('sanitizePens keeps valid pens, drops junk, caps at MAX, defaults size', () => {
    const out = sanitizePens([
      { id: 'a', color: '#123456', size: 3, type: 'pen' },
      { color: '#abc' }, // missing id+size → id generated, size defaulted
      { size: 5 }, // no color → dropped
      'nonsense',
      null,
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'a', color: '#123456', size: 3 })
    expect(out[1].color).toBe('#abc')
    expect(out[1].size).toBe(2)
    expect(out[1].id).toBeTruthy()
  })

  it('sanitizePens caps at MAX_PENS', () => {
    const many = Array.from({ length: MAX_PENS + 5 }, (_, i) => ({ id: `p${i}`, color: '#000', size: 2 }))
    expect(sanitizePens(many)).toHaveLength(MAX_PENS)
  })

  it('sanitizePens returns [] for non-arrays', () => {
    expect(sanitizePens(null)).toEqual([])
    expect(sanitizePens({ a: 1 })).toEqual([])
  })
})

describe('pens — legacy migration', () => {
  it('zips legacy pen-colors + pen-sizes into PenConfig[] (keeps customised values)', () => {
    const pens = pensFromLegacy(JSON.stringify(['#111', '#222', '#333']), JSON.stringify([1, 2.5, 4]))
    expect(pens).toEqual([
      { id: 'pen-1', color: '#111', size: 1, type: 'pen' },
      { id: 'pen-2', color: '#222', size: 2.5, type: 'pen' },
      { id: 'pen-3', color: '#333', size: 4, type: 'pen' },
    ])
  })

  it('falls back to default sizes when sizes are missing', () => {
    const pens = pensFromLegacy(JSON.stringify(['#111', '#222']), null)
    expect(pens?.map((p) => p.size)).toEqual([2, 2])
    expect(pens?.map((p) => p.color)).toEqual(['#111', '#222'])
  })

  it('returns null when there is no legacy data', () => {
    expect(pensFromLegacy(null, null)).toBeNull()
  })

  it('DEFAULT_PENS are the historical black/red/blue at size 2', () => {
    expect(DEFAULT_PENS.map((p) => p.color)).toEqual(['#000000', '#FF0000', '#0000FF'])
    expect(DEFAULT_PENS.every((p) => p.size === 2 && p.type === 'pen')).toBe(true)
  })
})
