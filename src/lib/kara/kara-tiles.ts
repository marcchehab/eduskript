/**
 * Tileset rendering for the Kara world.
 *
 * The art is a licensed pack (gameart2d "Sci-fi Top Down Tileset") that may
 * not be redistributed, so it is NOT in this repo. It is served from
 * NEXT_PUBLIC_KARA_TILESET_URL (bucket in prod, /kara-tiles from a gitignored
 * public/ folder in dev). Without that variable — e.g. in a fork — every tile
 * falls back to a labelled placeholder; the world stays fully usable.
 *
 * Walls are autotiled: each `#` cell picks one of the pack's wall pieces from
 * its 8 neighbours (metal border where the neighbour is not a wall, a small
 * nub for inner corners). A wall with floor directly south is drawn as the
 * wall's front face instead (3/4 perspective). The pack covers 32 of the 47
 * neighbour combinations; the rest use the closest piece (see pickWall).
 */

import { BLOCK, BOX, CHIP, DOOR, ITEM, LASER, type KaraWorld } from './world'

export const KARA_TILESET_URL = (process.env.NEXT_PUBLIC_KARA_TILESET_URL || '').replace(/\/$/, '')

// Mask bits: border on a side (neighbour is not a wall) + inner-corner nubs.
const N = 1, E = 2, S = 4, W = 8, NE = 16, SE = 32, SW = 64, NW = 128

/** mask → wall piece number (file wall-<n>.png), read off the pack's tiles. */
const WALL_PIECES: Record<number, number> = {
  0: 10, [NW]: 19, [SW]: 17, [SW | NW]: 21, [SE]: 16, [SE | SW]: 23, [NE]: 18,
  [NE | NW]: 22, [NE | SE]: 20, [NE | SE | SW | NW]: 34,
  [W]: 11, [W | NE | SE]: 24, [S]: 13, [S | NE | NW]: 27, [S | W]: 12, [S | W | NE]: 30,
  [E]: 9, [E | SW | NW]: 25, [E | W]: 33, [E | S]: 14, [E | S | NW]: 31, [E | S | W]: 35,
  [N]: 7, [N | SE | SW]: 26, [N | W]: 6, [N | W | SE]: 28, [N | S]: 2, [N | S | W]: 1,
  [N | E]: 8, [N | E | SW]: 29, [N | E | W]: 32, [N | E | S]: 5,
}
const WALL_MASKS = Object.keys(WALL_PIECES).map(Number)

const bits = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1 } return c }

/** Exact piece if the pack has it, else the one with the fewest differing edges (then nubs). */
function pickWall(mask: number): number {
  if (mask in WALL_PIECES) return WALL_PIECES[mask]
  let best = 0, bestScore = Infinity
  for (const m of WALL_MASKS) {
    const score = bits((m ^ mask) & 15) * 10 + bits((m ^ mask) & 240)
    if (score < bestScore) { bestScore = score; best = m }
  }
  return WALL_PIECES[best]
}

const OBSTACLES: Record<string, string> = {
  T: 'table', P: 'desk', L: 'locker', R: 'barrel-red', Y: 'barrel-yellow', t: 'terminal',
}
/** Static floor objects drawn from `look` (not flags). */
const FLOOR_OBJECTS: Record<string, string> = { S: 'switch', E: 'exit' }

const TILE_NAMES = [
  'floor', 'grate', 'face', 'face-alt', 'face-sign', 'item', 'box',
  'door-closed', 'door-open', 'laser-h', 'laser-v', 'acid',
  ...Object.values(OBSTACLES), ...Object.values(FLOOR_OBJECTS),
  ...[...new Set(Object.values(WALL_PIECES))].map(n => `wall-${n}`),
]

export type KaraTileset = Map<string, HTMLImageElement>

let tilesetPromise: Promise<KaraTileset> | null = null

/** Loads every tile once per page. Missing files are simply absent (→ placeholder). */
export function loadKaraTileset(): Promise<KaraTileset> {
  tilesetPromise ??= (async () => {
    const set: KaraTileset = new Map()
    if (!KARA_TILESET_URL) return set
    await Promise.all(TILE_NAMES.map(name => new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => { set.set(name, img); resolve() }
      img.onerror = () => resolve()
      img.src = `${KARA_TILESET_URL}/${name}.png`
    })))
    return set
  })()
  return tilesetPromise
}

// Doors sit inside walls, so they count as wall for the autotiler.
const WALL_LOOKS = new Set(['#', 'D'])

// Deterministic per-cell variation (wall faces), stable across redraws.
const cellHash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0

/** Tile name for a `#` cell. Out-of-bounds counts as wall so the rim closes. */
function wallTile(world: KaraWorld, x: number, y: number): string {
  const isWall = (cx: number, cy: number) =>
    cx < 0 || cy < 0 || cx >= world.cols || cy >= world.rows || WALL_LOOKS.has(world.look[cy * world.cols + cx])
  if (y + 1 < world.rows && !isWall(x, y + 1)) {
    const h = cellHash(x, y) % 10
    return h === 0 ? 'face-sign' : h < 3 ? 'face-alt' : 'face'
  }
  const n = isWall(x, y - 1), e = isWall(x + 1, y), s = isWall(x, y + 1), w = isWall(x - 1, y)
  let mask = 0
  if (!n) mask |= N
  if (!e) mask |= E
  if (!s) mask |= S
  if (!w) mask |= W
  if (n && e && !isWall(x + 1, y - 1)) mask |= NE
  if (s && e && !isWall(x + 1, y + 1)) mask |= SE
  if (s && w && !isWall(x - 1, y + 1)) mask |= SW
  if (n && w && !isWall(x - 1, y - 1)) mask |= NW
  return `wall-${pickWall(mask)}`
}

// ─── Placeholders (no tileset) ────────────────────────────────────────────

const PLACEHOLDER: Record<string, { fill: string; label?: string }> = {
  floor: { fill: '#e2e8f0' }, grate: { fill: '#cbd5e1' },
  wall: { fill: '#334155' },
  item: { fill: '#16a34a', label: 'item' }, box: { fill: '#a16207', label: 'box' },
  table: { fill: '#64748b', label: 'T' }, desk: { fill: '#64748b', label: 'D' },
  locker: { fill: '#64748b', label: 'L' }, 'barrel-red': { fill: '#dc2626', label: 'R' },
  'barrel-yellow': { fill: '#ca8a04', label: 'Y' },
  terminal: { fill: '#0f766e', label: 't' }, switch: { fill: '#7c3aed', label: 'S' },
  exit: { fill: '#15803d', label: 'E' }, acid: { fill: '#84cc16' },
  'door-closed': { fill: '#475569', label: 'D' }, 'door-open': { fill: '#cbd5e1', label: 'd' },
  'laser-h': { fill: '#ef4444', label: '=' }, 'laser-v': { fill: '#ef4444', label: '|' },
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, s: number, full: boolean) {
  const p = PLACEHOLDER[name.startsWith('wall') || name.startsWith('face') ? 'wall' : name] ?? { fill: '#94a3b8', label: '?' }
  ctx.fillStyle = p.fill
  if (full) {
    ctx.fillRect(x, y, s, s)
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
  } else {
    const pad = s * 0.18
    ctx.beginPath(); ctx.roundRect(x + pad, y + pad, s - 2 * pad, s - 2 * pad, s * 0.1); ctx.fill()
  }
  if (p.label && s >= 20) {
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(s * 0.22)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.label, x + s / 2, y + s / 2)
  }
}

/** Full-cell tile (floor, wall). */
function drawCell(ctx: CanvasRenderingContext2D, set: KaraTileset, name: string, x: number, y: number, s: number) {
  const img = set.get(name)
  if (img) ctx.drawImage(img, x, y, s, s)
  else drawPlaceholder(ctx, name, x, y, s, true)
}

/** Object standing in a cell: fitted to 86 % of the cell, bottom-aligned. */
function drawObject(ctx: CanvasRenderingContext2D, set: KaraTileset, name: string, x: number, y: number, s: number) {
  const img = set.get(name)
  if (!img) { drawPlaceholder(ctx, name, x, y, s, false); return }
  const f = (s * 0.86) / Math.max(img.naturalWidth, img.naturalHeight)
  const w = img.naturalWidth * f
  const h = img.naturalHeight * f
  ctx.drawImage(img, x + (s - w) / 2, y + s - h - s * 0.06, w, h)
}

/**
 * Draw the world (without Kara). `cells` is the current flag state (items and
 * boxes move); walls/obstacles come from the static `world.look`.
 */
export function drawKaraTiles(ctx: CanvasRenderingContext2D, world: KaraWorld, cells: number[], tile: number, set: KaraTileset) {
  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const i = y * world.cols + x
      const look = world.look[i]
      const c = cells[i]
      const px = x * tile
      const py = y * tile
      if (look === '#') { drawCell(ctx, set, wallTile(world, x, y), px, py, tile); continue }
      // `x` (crate) is the pack's floor grate; it reads as a crate, so it blocks.
      drawCell(ctx, set, look === 'x' ? 'grate' : look === '~' ? 'acid' : 'floor', px, py, tile)
      if (look === 'D') drawCell(ctx, set, c & DOOR ? 'door-closed' : 'door-open', px, py, tile)
      if ((look === '=' || look === '|') && c & LASER) drawCell(ctx, set, look === '=' ? 'laser-h' : 'laser-v', px, py, tile)
      if (look === 'o') drawTarget(ctx, px, py, tile)
      if (look === 's') drawSlime(ctx, x, y, px, py, tile)
      if (FLOOR_OBJECTS[look]) drawObject(ctx, set, FLOOR_OBJECTS[look], px, py, tile)
      if (c & BLOCK && OBSTACLES[look]) drawObject(ctx, set, OBSTACLES[look], px, py, tile)
      if (c & CHIP) drawChip(ctx, px, py, tile)
      if (c & ITEM) drawObject(ctx, set, 'item', px, py, tile)
      if (c & BOX) drawObject(ctx, set, 'box', px, py, tile)
    }
  }
}

// ─── Vector overlays (no matching art in the pack) ────────────────────────

function drawTarget(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.save()
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = Math.max(1.5, s * 0.05)
  ctx.setLineDash([s * 0.12, s * 0.08])
  ctx.strokeRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72)
  ctx.restore()
}

function drawSlime(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number) {
  const h = cellHash(x, y)
  ctx.save()
  ctx.fillStyle = 'rgba(132, 204, 22, 0.55)'
  for (let k = 0; k < 3; k++) {
    const ox = ((h >> (k * 4)) % 60) / 100 + 0.2
    const oy = ((h >> (k * 4 + 2)) % 60) / 100 + 0.2
    ctx.beginPath(); ctx.ellipse(px + ox * s, py + oy * s, s * 0.16, s * 0.1, (h % 7) / 3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

function drawChip(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  const w = s * 0.34
  const x0 = px + (s - w) / 2
  const y0 = py + (s - w) / 2
  ctx.save()
  ctx.shadowColor = '#22d3ee'
  ctx.shadowBlur = s * 0.2
  ctx.fillStyle = '#0e7490'
  ctx.fillRect(x0, y0, w, w)
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#a5f3fc'
  ctx.lineWidth = Math.max(1, s * 0.02)
  for (let k = 1; k < 4; k++) {
    const o = (w * k) / 4
    ctx.beginPath()
    ctx.moveTo(x0 + o, y0 - s * 0.05); ctx.lineTo(x0 + o, y0 + w + s * 0.05)
    ctx.moveTo(x0 - s * 0.05, y0 + o); ctx.lineTo(x0 + w + s * 0.05, y0 + o)
    ctx.stroke()
  }
  ctx.fillStyle = '#67e8f9'
  ctx.fillRect(x0 + w * 0.3, y0 + w * 0.3, w * 0.4, w * 0.4)
  ctx.restore()
}

/**
 * Facing indicator: a headlamp cone from MOP-7 into the cell in front, with a
 * small chevron at its tip. Drawn before the sprite, so the sprite covers the
 * cone's root. (x, y) may be fractional (slide animation); d: 0 = N … 3 = W.
 * Near the world's edge the cone is clipped by the canvas (no torus wrap).
 */
export function drawKaraFacing(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, s: number) {
  const cx = (x + 0.5) * s
  const cy = (y + 0.5) * s
  const angle = (d - 1) * (Math.PI / 2) // 0 rad = east
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const r0 = s * 0.3, r1 = s * 1.05
  const g = ctx.createLinearGradient(r0, 0, r1, 0)
  g.addColorStop(0, 'rgba(253, 230, 138, 0.55)')
  g.addColorStop(1, 'rgba(253, 230, 138, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(r0, -s * 0.12)
  ctx.lineTo(r1, -s * 0.36)
  ctx.lineTo(r1, s * 0.36)
  ctx.lineTo(r0, s * 0.12)
  ctx.closePath()
  ctx.fill()
  // Chevron in the front cell, outlined so it reads on light and dark tiles.
  const t = s * 0.62, w = s * 0.11
  ctx.beginPath()
  ctx.moveTo(t - w, -w * 1.3)
  ctx.lineTo(t + w * 0.6, 0)
  ctx.lineTo(t - w, w * 1.3)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(28, 25, 23, 0.7)'
  ctx.lineWidth = Math.max(2.5, s * 0.08)
  ctx.stroke()
  ctx.strokeStyle = '#fde047'
  ctx.lineWidth = Math.max(1.5, s * 0.045)
  ctx.stroke()
  ctx.restore()
}
