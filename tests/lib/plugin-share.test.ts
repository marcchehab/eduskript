import { describe, it, expect } from 'vitest'
import {
  isValidListName, mergeValues, parseKeep,
  rankTotals, sanitizeValues, sumByUser,
} from '@/lib/plugin-share'

describe('plugin-share helpers', () => {
  it('accepts lowercase list names only', () => {
    expect(isValidListName('class')).toBe(true)
    expect(isValidListName('toplist-logarithms')).toBe(true)
    for (const bad of ['', 'Top', 'a b', '-a', 'a"b', 'x'.repeat(65), 7, null]) {
      expect(isValidListName(bad)).toBe(false)
    }
  })

  it('keeps only finite numbers under short keys', () => {
    expect(sanitizeValues({ score: 3, level: 1.5 })).toEqual({ score: 3, level: 1.5 })
    expect(sanitizeValues({ score: Infinity, name: 'x', 'a b': 1 })).toBeNull()
    expect(sanitizeValues([1])).toBeNull()
    expect(sanitizeValues({ score: -1 })).toBeNull()
    expect(sanitizeValues({ score: 1e308 })).toBeNull()
    expect(sanitizeValues({ score: 1_000_000 })).toEqual({ score: 1_000_000 })
    expect(sanitizeValues(null)).toBeNull()
    expect(Object.keys(sanitizeValues(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])))!)).toHaveLength(10)
  })

  it('best keeps the higher value, last the newest, other keys stay', () => {
    expect(mergeValues({ score: 9, t: 1 }, { score: 3 }, 'best')).toEqual({ score: 9, t: 1 })
    expect(mergeValues({ score: 9, t: 1 }, { score: 3 }, 'last')).toEqual({ score: 3, t: 1 })
    expect(mergeValues({ score: 2 }, { score: 3 }, 'best')).toEqual({ score: 3 })
    expect(mergeValues(null, { score: 3 }, 'best')).toEqual({ score: 3 })
    expect(parseKeep('last')).toBe('last')
    expect(parseKeep('nonsense')).toBe('best')
  })

  it('sums several embeddings per user and shares ranks on ties', () => {
    const totals = sumByUser([
      { userId: 'a', data: { score: 2 } },
      { userId: 'a', data: { score: 3 } },
      { userId: 'b', data: { score: 5 } },
      { userId: 'c', data: { score: 1 } },
      { userId: 'd', data: { other: 9 } },
    ], 'score')
    expect(rankTotals(totals).map((r) => [r.userId, r.value, r.rank])).toEqual([
      ['a', 5, 1], ['b', 5, 1], ['c', 1, 3],
    ])
  })
})
