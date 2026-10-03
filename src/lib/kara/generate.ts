/**
 * Kara world generators: `generate: <kind> key=value …` in a kara-world
 * config block (see world.ts header). Each line yields `count` variants that
 * parseKaraLevel appends after the hand-drawn grids.
 *
 * Deterministic: the PRNG (mulberry32) is seeded from a string hash of
 * `seed=` (or the level `id:`, or — when neither is set — the spec line
 * itself) plus the spec line, so the browser and check.ts build the same
 * worlds. Changing the spec line or the level id changes every world.
 *
 * Every generator builds an ASCII grid (legend of world.ts), parses it with
 * parseKaraWorld and then sets Kara's position (so Kara can start on an item).
 * All generated worlds are closed by walls; nothing wraps.
 */

import { parseKaraWorld, BLOCK, CHIP, EXIT, TERMINAL, type KaraDir, type KaraWorld } from './world'

export type KaraGenKind = 'corridor' | 'room' | 'maze' | 'stairs'

/** mulberry32: tiny 32-bit PRNG, returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit string hash (seed for mulberry32). */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

class Rng {
  private next: () => number
  constructor(seed: string) { this.next = mulberry32(hash(seed)) }
  float(): number { return this.next() }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)) }
  int2(r: Range): number { return this.int(r[0], r[1]) }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  /**
   * `count` values from [lo, hi], all different while the range allows
   * (shuffled range, repeated in new shuffles when count > range size), so a
   * suite of corridors really has different lengths.
   */
  spread(r: Range, count: number): number[] {
    const out: number[] = []
    while (out.length < count) {
      const vals = Array.from({ length: r[1] - r[0] + 1 }, (_, i) => r[0] + i)
      out.push(...this.shuffle(vals))
    }
    return out.slice(0, count)
  }
}

type Range = [number, number]

/** `5..14` → [5, 14], `7` → [7, 7]; invalid → fallback. Bounds clamped to [min, max]. */
function range(v: string | undefined, fallback: Range, min: number, max: number): Range {
  const m = v?.match(/^(\d+)(?:\.\.(\d+))?$/)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  if (!m) return fallback
  const a = clamp(parseInt(m[1], 10))
  const b = clamp(m[2] ? parseInt(m[2], 10) : a)
  return a <= b ? [a, b] : [b, a]
}

/** Upper bound for `count=` (each variant is a Test-all-worlds run). */
const MAX_COUNT = 20

/** Grid (array of rows of chars) → KaraWorld with Kara at (x, y) facing d. */
function toWorld(g: string[][], x: number, y: number, d: KaraDir): KaraWorld {
  const w = parseKaraWorld(g.map(r => r.join('')).join('\n'))
  w.kara = { x, y, d }
  return w
}

function walls(cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, () => new Array<string>(cols).fill('#'))
}

/** 1-row corridor: Kara at the west end facing east, exit in the wall above the east end (enter facing north), optional green barrels in between. */
function corridor(rng: Rng, o: Record<string, string>, count: number): KaraWorld[] {
  const items = range(o.items, [0, 0], 0, 60)
  return rng.spread(range(o.len, [5, 14], 2, 60), count).map(len => {
    const g = walls(len + 2, 3)
    for (let x = 1; x <= len; x++) g[1][x] = '.'
    g[0][len] = 'E'
    const free = rng.shuffle(Array.from({ length: Math.max(0, len - 2) }, (_, i) => i + 2))
    for (const x of free.slice(0, rng.int2(items))) g[1][x] = '*'
    return toWorld(g, 1, 1, 1)
  })
}

/**
 * Closed room of w × h floor cells, Kara top-left facing east, green barrels
 * ('*', the slime to clean up) on every cell (`slime=all`, default) or on each
 * cell with probability p (`slime=0.3`; at least one barrel when p > 0). No exit.
 */
function room(rng: Rng, o: Record<string, string>, count: number): KaraWorld[] {
  const wr = range(o.w, [3, 7], 1, 40)
  const hr = range(o.h, [2, 5], 1, 40)
  const p = !o.slime || o.slime === 'all' ? 1 : Math.min(1, Math.max(0, parseFloat(o.slime) || 0))
  return Array.from({ length: count }, () => {
    const w = rng.int2(wr), h = rng.int2(hr)
    const g = walls(w + 2, h + 2)
    let n = 0
    for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
      const slime = p >= 1 || rng.float() < p
      g[y][x] = slime ? '*' : '.'
      if (slime) n++
    }
    if (p > 0 && n === 0) g[rng.int(1, h)][rng.int(1, w)] = '*'
    return toWorld(g, 1, 1, 1)
  })
}

/**
 * Staircase down to the south-east (the shape of week 1's «Treppenhaus»):
 * Kara at the top facing east; one step = turn_right, move, turn_left, move.
 * A solution: move(), `steps` × stufe(), move() lands on the exit.
 */
function stairs(rng: Rng, o: Record<string, string>, count: number): KaraWorld[] {
  return rng.spread(range(o.steps, [3, 8], 1, 40), count).map(n => {
    const g = walls(n + 5, n + 3)
    for (let r = 1; r <= n + 1; r++) g[r][r] = g[r][r + 1] = '.'
    g[n + 1][n + 3] = 'E'
    return toWorld(g, 1, 1, 1)
  })
}

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]

/**
 * Cells a wall follower visits (right hand: `right = true`), in order, from
 * (x, y, d) until its state (x, y, dir) repeats or `stop(x, y)` holds. Mirrors
 * the usual student program: side free → turn to it + move; else front free →
 * move; else turn the other way. O(4 · cells) steps at most.
 */
function wallFollow(
  free: (x: number, y: number) => boolean, x: number, y: number, d: number, right: boolean,
  stop: (x: number, y: number) => boolean = () => false,
): string[] {
  const seen = new Set<string>(), order = [`${x},${y}`]
  const side = right ? 1 : 3
  while (!seen.has(`${x},${y},${d}`) && !stop(x, y)) {
    seen.add(`${x},${y},${d}`)
    const s = (d + side) % 4
    if (free(x + DX[s], y + DY[s])) { d = s; x += DX[d]; y += DY[d] }
    else if (free(x + DX[d], y + DY[d])) { x += DX[d]; y += DY[d] }
    else { d = (d + 4 - side) % 4; continue }
    order.push(`${x},${y}`)
  }
  return order
}

/**
 * Maze on an odd grid (w, h = total size incl. outer walls, rounded up to odd,
 * 5..61): perfect maze by iterative randomized DFS from (1, 1), Kara there
 * facing east.
 *
 * loops=0: exit on the dead end farthest (BFS) from the start — the
 * right/left-hand rule always finds it.
 * loops=k: k random inner walls between two corridors are removed, which
 * creates cycles around wall islands. The exit then goes to the farthest cell
 * that neither the right- nor the left-hand follower (wallFollow) visits,
 * so the wall-follower program runs in circles (wallFollow). Up to 50 tries per variant;
 * if no such cell exists (tiny maze, few loops) the exit falls back to the
 * farthest cell and the right-hand rule may reach it.
 */
function maze(rng: Rng, o: Record<string, string>, count: number): KaraWorld[] {
  const wr = range(o.w, [9, 9], 5, 61), hr = range(o.h, [9, 9], 5, 61)
  const loops = range(o.loops, [0, 0], 0, 400)
  const odd = (n: number) => (n % 2 ? n : n + 1)
  return Array.from({ length: count }, () => {
    const W = odd(rng.int2(wr)), H = odd(rng.int2(hr)), k = rng.int2(loops)
    let g: string[][] = [], exit: [number, number] | null = null
    for (let attempt = 0; attempt < 50 && !exit; attempt++) {
      g = walls(W, H)
      g[1][1] = '.'
      const stack: [number, number][] = [[1, 1]]
      while (stack.length) {
        const [x, y] = stack[stack.length - 1]
        const next = rng.shuffle([0, 1, 2, 3]).map(d => [x + 2 * DX[d], y + 2 * DY[d], d] as const)
          .find(([nx, ny]) => nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny][nx] === '#')
        if (!next) { stack.pop(); continue }
        const [nx, ny, d] = next
        g[y + DY[d]][x + DX[d]] = g[ny][nx] = '.'
        stack.push([nx, ny])
      }
      const inner: [number, number][] = []
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (g[y][x] !== '#' || (x + y) % 2 === 0) continue
        const between = x % 2 === 0 ? g[y][x - 1] === '.' && g[y][x + 1] === '.' : g[y - 1][x] === '.' && g[y + 1][x] === '.'
        if (between) inner.push([x, y])
      }
      for (const [x, y] of rng.shuffle(inner).slice(0, k)) g[y][x] = '.'

      const dist = distances(g, 1, 1)
      const cells: [number, number][] = []
      for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) if (x !== 1 || y !== 1) cells.push([x, y])
      let pool: [number, number][]
      if (k === 0) {
        const open = (x: number, y: number) => [0, 1, 2, 3].filter(d => g[y + DY[d]][x + DX[d]] !== '#').length
        pool = cells.filter(([x, y]) => open(x, y) === 1)
      } else {
        const free = (x: number, y: number) => g[y]?.[x] !== undefined && g[y][x] !== '#'
        const r = new Set(wallFollow(free, 1, 1, 1, true)), l = new Set(wallFollow(free, 1, 1, 1, false))
        pool = cells.filter(([x, y]) => !r.has(`${x},${y}`) && !l.has(`${x},${y}`))
        if (!pool.length && attempt < 49) continue
        if (!pool.length) pool = cells
      }
      exit = farthest(pool, dist, W)
    }
    if (exit) g[exit[1]][exit[0]] = 'E'
    return toWorld(g, 1, 1, 1)
  })
}

/** BFS distances over non-wall cells of an ASCII grid (-1 = unreachable). Row-major. */
function distances(g: string[][], sx: number, sy: number): number[] {
  const H = g.length, W = g[0].length
  const dist = new Array<number>(W * H).fill(-1)
  dist[sy * W + sx] = 0
  const queue = [sy * W + sx]
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % W, y = Math.floor(i / W)
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || g[ny][nx] === '#' || dist[ny * W + nx] !== -1) continue
      dist[ny * W + nx] = dist[i] + 1
      queue.push(ny * W + nx)
    }
  }
  return dist
}

/** Reachable cell of `pool` with the largest distance; ties → first in the list. */
function farthest(pool: [number, number][], dist: number[], W: number): [number, number] | null {
  let best: [number, number] | null = null, bd = 0
  for (const [x, y] of pool) if (dist[y * W + x] > bd) { best = [x, y]; bd = dist[y * W + x] }
  return best
}

/**
 * BFS distances from Kara over every cell that is not BLOCK, on the torus
 * (walking off an edge enters on the other side, like the simulation).
 * Doors, lasers, acid and boxes count as passable — this is a reachability
 * check for generated worlds, which contain none of those.
 */
export function karaDistances(world: KaraWorld): number[] {
  const { cols, rows, cells, kara } = world
  const dist = new Array<number>(cols * rows).fill(-1)
  const start = kara.y * cols + kara.x
  dist[start] = 0
  const queue = [start]
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % cols, y = Math.floor(i / cols)
    for (let d = 0; d < 4; d++) {
      const j = ((y + DY[d] + rows) % rows) * cols + (x + DX[d] + cols) % cols
      if (cells[j] & BLOCK || dist[j] !== -1) continue
      dist[j] = dist[i] + 1
      queue.push(j)
    }
  }
  return dist
}

/**
 * `place: c far` — put legend char `c` (any non-blocking floor object, e.g. a
 * chip) on the reachable cell farthest from Kara (BFS; not Kara's cell, not
 * the exit; ties → first in reading order). When the world has an exit that
 * the right-hand wall follower reaches, only cells it passes BEFORE the exit
 * count — otherwise `while not on_exit()` + right-hand rule would stop at the
 * exit with the chip still lying behind it (there is no chip sensor). Flags
 * are OR-ed in, so a chip on a barrel keeps the barrel. Rebuilds the chip /
 * terminal lists.
 */
export function placeFar(world: KaraWorld, ch: string): void {
  const parsed = parseKaraWorld(ch)
  const flags = parsed.cells[0]
  if (flags & BLOCK) return
  const { cols, rows, cells, kara } = world
  const at = (x: number, y: number) => ((y + rows) % rows) * cols + (x + cols) % cols
  const dist = karaDistances(world)
  let allowed: Set<number> | null = null
  if (cells.some(c => c & EXIT)) {
    const path = wallFollow((x, y) => !(cells[at(x, y)] & BLOCK), kara.x, kara.y, kara.d, true, (x, y) => !!(cells[at(x, y)] & EXIT))
    const [lx, ly] = path[path.length - 1].split(',').map(Number)
    if (cells[at(lx, ly)] & EXIT) allowed = new Set(path.map(k => { const [x, y] = k.split(',').map(Number); return at(x, y) }))
  }
  let best = -1
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] <= 0 || cells[i] & EXIT || (allowed && !allowed.has(i))) continue
    if (best === -1 || dist[i] > dist[best]) best = i
  }
  if (best === -1) return
  cells[best] |= flags
  if (parsed.look[0] !== '.') world.look[best] = parsed.look[0]
  const list = (f: number) => cells.flatMap((c, i) => (c & f ? [[i % cols, Math.floor(i / cols)] as [number, number]] : []))
  world.chips = list(CHIP)
  world.terminals = list(TERMINAL)
}

const GENERATORS: Record<KaraGenKind, (rng: Rng, o: Record<string, string>, count: number) => KaraWorld[]> = {
  corridor, room, maze, stairs,
}

/**
 * One `generate:` line → its worlds. `seedBase` is the level id (or '' when
 * the level has none). Unknown kinds yield no worlds.
 * Default counts: corridor 6, room 5, maze 6, stairs 4 (max 20).
 */
export function generateWorlds(spec: string, seedBase: string): KaraWorld[] {
  const [kind, ...rest] = spec.trim().split(/\s+/)
  const gen = GENERATORS[kind as KaraGenKind]
  if (!gen) return []
  const o: Record<string, string> = {}
  for (const f of rest) {
    const m = f.match(/^([a-z]+)=(.+)$/)
    if (m) o[m[1]] = m[2]
  }
  const defaults: Record<KaraGenKind, number> = { corridor: 6, room: 5, maze: 6, stairs: 4 }
  const count = Math.min(MAX_COUNT, Math.max(1, parseInt(o.count, 10) || defaults[kind as KaraGenKind]))
  return gen(new Rng(`${o.seed ?? seedBase}\n${spec.trim()}`), o, count)
}
