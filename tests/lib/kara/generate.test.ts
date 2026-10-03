import { describe, it, expect } from 'vitest'
import { generateWorlds, karaDistances, placeFar } from '@/lib/kara/generate'
import { parseKaraLevel, BLOCK, CHIP, EXIT, ITEM, type KaraWorld } from '@/lib/kara/world'

const exitOf = (w: KaraWorld) => w.cells.findIndex(c => c & EXIT)
const reachable = (w: KaraWorld, i: number) => karaDistances(w)[i] >= 0

/** Python-free replay of the classic wall follower; true when it reaches the exit. */
function rightHandReaches(w: KaraWorld, needChip = false): boolean {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]
  const free = (x: number, y: number) => !(w.cells[y * w.cols + x] & BLOCK)
  let { x, y, d } = w.kara
  let chip = false
  for (let n = 0; n < 20000; n++) {
    if (w.cells[y * w.cols + x] & CHIP) chip = true
    if (w.cells[y * w.cols + x] & EXIT) return chip || !needChip
    const r = (d + 1) % 4
    if (free(x + DX[r], y + DY[r])) { d = r as typeof d; x += DX[d]; y += DY[d] }
    else if (free(x + DX[d], y + DY[d])) { x += DX[d]; y += DY[d] }
    else d = ((d + 3) % 4) as typeof d
  }
  return false
}

describe('generateWorlds', () => {
  it('is deterministic and depends on the seed', () => {
    const a = generateWorlds('maze w=11 h=9 count=3', 'w6-l2')
    const b = generateWorlds('maze w=11 h=9 count=3', 'w6-l2')
    const c = generateWorlds('maze w=11 h=9 count=3', 'other')
    expect(a.map(w => w.look.join(''))).toEqual(b.map(w => w.look.join('')))
    expect(a.map(w => w.look.join(''))).not.toEqual(c.map(w => w.look.join('')))
    expect(generateWorlds('corridor seed=7', 'x').map(w => w.cols)).toEqual(generateWorlds('corridor seed=7', 'y').map(w => w.cols))
  })

  it('corridor: lengths in range and distinct, solvable, items between start and exit', () => {
    const ws = generateWorlds('corridor len=5..14 items=0..3 count=6', 's')
    expect(ws).toHaveLength(6)
    const lens = ws.map(w => w.cols - 2)
    expect(new Set(lens).size).toBe(6)
    for (const w of ws) {
      expect(w.cols - 2).toBeGreaterThanOrEqual(5)
      expect(w.cols - 2).toBeLessThanOrEqual(14)
      expect(w.rows).toBe(3)
      expect(w.kara).toEqual({ x: 1, y: 1, d: 1 })
      expect(exitOf(w)).toBe(w.cols + w.cols - 2)
      expect(reachable(w, exitOf(w))).toBe(true)
      const items = w.cells.filter(c => c & ITEM).length
      expect(items).toBeLessThanOrEqual(3)
      expect(w.cells[w.cols + 1] & ITEM).toBe(0)
    }
  })

  it('room: sizes in range, barrels everywhere with slime=all, none outside', () => {
    for (const w of generateWorlds('room w=3..7 h=2..5 count=5', 's')) {
      const iw = w.cols - 2, ih = w.rows - 2
      expect(iw).toBeGreaterThanOrEqual(3); expect(iw).toBeLessThanOrEqual(7)
      expect(ih).toBeGreaterThanOrEqual(2); expect(ih).toBeLessThanOrEqual(5)
      expect(w.cells.filter(c => c & ITEM)).toHaveLength(iw * ih)
      expect(w.kara).toEqual({ x: 1, y: 1, d: 1 })
      expect(w.cells.every((c, i) => !(c & ITEM) || reachable(w, i))).toBe(true)
    }
    for (const w of generateWorlds('room w=6 h=5 slime=0.3 count=5', 's')) {
      const n = w.cells.filter(c => c & ITEM).length
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThan(30)
    }
  })

  it('stairs: n steps, exit reachable at the bottom right', () => {
    const ws = generateWorlds('stairs steps=3..8 count=4', 's')
    for (const w of ws) {
      const n = w.rows - 3
      expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(8)
      expect(exitOf(w)).toBe((n + 1) * w.cols + n + 3)
      expect(reachable(w, exitOf(w))).toBe(true)
    }
    expect(new Set(ws.map(w => w.rows)).size).toBe(4)
  })

  it('maze: odd sizes, exit reachable on a dead end, right-hand rule solves it', () => {
    for (const w of generateWorlds('maze w=9..21 h=9..15 count=8', 's')) {
      expect(w.cols % 2).toBe(1); expect(w.rows % 2).toBe(1)
      expect(w.cols).toBeGreaterThanOrEqual(9); expect(w.cols).toBeLessThanOrEqual(21)
      const e = exitOf(w)
      expect(e).toBeGreaterThan(0)
      expect(reachable(w, e)).toBe(true)
      const open = [-1, 1, -w.cols, w.cols].filter(o => !(w.cells[e + o] & BLOCK)).length
      expect(open).toBe(1)
      expect(rightHandReaches(w)).toBe(true)
      // perfect maze: every odd cell reachable
      const dist = karaDistances(w)
      for (let y = 1; y < w.rows; y += 2) for (let x = 1; x < w.cols; x += 2) expect(dist[y * w.cols + x]).toBeGreaterThanOrEqual(0)
    }
  })

  it('maze loops=k: exit reachable but off the right-hand path', () => {
    const ws = generateWorlds('maze w=11 h=11 loops=4 count=6', 'w6-b1')
    for (const w of ws) {
      expect(reachable(w, exitOf(w))).toBe(true)
      expect(rightHandReaches(w)).toBe(false)
    }
  })

  it('ignores unknown kinds and caps count', () => {
    expect(generateWorlds('spiral count=3', 's')).toEqual([])
    expect(generateWorlds('corridor count=999', 's')).toHaveLength(20)
  })
})

describe('placeFar / parseKaraLevel with generate', () => {
  it('puts the chip on the farthest non-exit cell', () => {
    const [w] = generateWorlds('corridor len=8 count=1', 's')
    placeFar(w, 'c')
    expect(w.chips).toEqual([[7, 1]]) // exit at x=8, chip one before
    expect(w.cells[w.cols + 7] & CHIP).toBe(CHIP)
  })

  it('maze: the right-hand rule picks up the far chip before the exit', () => {
    for (const w of generateWorlds('maze w=9..15 h=9..11 count=12', 'chip')) {
      placeFar(w, 'c')
      expect(w.chips).toHaveLength(1)
      expect(rightHandReaches(w, true)).toBe(true)
    }
  })

  it('appends generated worlds after hand-drawn ones, seeded by the level id', () => {
    const src = `#>E#
---
id: w6-l4
goal: exit, chips
generate: maze w=11 h=11 count=3
place: c far`
    const a = parseKaraLevel(src), b = parseKaraLevel(src)
    expect(a.variants).toHaveLength(4)
    expect(a.config.generate).toEqual(['maze w=11 h=11 count=3'])
    expect(a.config.place).toBe('c')
    expect(a.variants[0].chips).toEqual([])
    for (const w of a.variants.slice(1)) {
      expect(w.chips).toHaveLength(1)
      const [x, y] = w.chips[0]
      expect(reachable(w, y * w.cols + x)).toBe(true)
    }
    expect(a.variants.map(w => w.look.join(''))).toEqual(b.variants.map(w => w.look.join('')))
    expect(parseKaraLevel(src.replace('w6-l4', 'w6-l5')).variants[1].look).not.toEqual(a.variants[1].look)
  })

  it('generate alone (no grid) yields only generated worlds', () => {
    expect(parseKaraLevel('---\ngenerate: stairs steps=4 count=2').variants).toHaveLength(2)
  })
})
