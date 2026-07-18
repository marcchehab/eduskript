/**
 * Modular annotation pens.
 *
 * The annotation toolbar's pens are user-configurable: add, remove, reorder,
 * recolour, resize — persisted to the visitor's own device (localStorage).
 * Each pen is self-contained; saved strokes already bake in their own
 * colour/width (see StrokeData in src/lib/indexeddb/annotations.ts), so the
 * pen *config* is purely a toolbar concern and never affects stored
 * annotations.
 *
 * `type` is 'pen' (freehand draw) or 'highlight' (text highlighter — selecting
 * text marks it in the pen's colour, never broadcast, always personal).
 */

export type PenType = 'pen' | 'highlight'

export interface PenConfig {
  id: string
  color: string
  size: number
  type: PenType
}

/** Theme "ink": a stroke stored as `currentColor` renders in the page
 *  foreground — black in light mode, white in dark — and flips live when the
 *  theme toggles (SVG `fill="currentColor"` inherits the layer's CSS `color`;
 *  the raster canvas resolves it via getComputedStyle). See the ink zone at
 *  the bottom of the colour slider (annotation-toolbar + .hue-slider CSS). */
export const FOREGROUND_COLOR = 'currentColor'

/** The colour slider is a single track: the bottom [TRACK_MIN, 0) is the solid
 *  ink zone (theme foreground, not blended into the rainbow); [0, 360] is the
 *  hue rainbow. TRACK_MIN/-36 makes the ink zone the bottom 36/396 ≈ 9.1% of
 *  the track — about one thumb tall, so the parked thumb fills it just below
 *  red. Keep 9.1% in sync with the gradient stop in `.hue-slider`. */
export const TRACK_MIN = -36
// Ink parks near the bottom of the track, lifted ~2px off the floor so the
// thumb sits cleanly on the ink block below red (not flush to the edge). The
// lift is baked into the value — WebKit ignores transform/margin on the thumb —
// as ~5 track units over the ≈176px track (396-unit range → ~2px).
const INK_TRACK_VALUE = TRACK_MIN + 5

/** Map a slider track value to a CSS colour. Negative → theme ink; 0–360 → a
 *  vivid hue. Used by the colour picker shared by pens and highlighters and
 *  stored verbatim as the pen colour. */
export function hueToColor(value: number): string {
  if (value < 0) return FOREGROUND_COLOR
  return `hsl(${Math.round(value)} 85% 55%)`
}

/** Recover a slider track value from a pen colour so the thumb can be
 *  positioned. `currentColor` → the ink zone; `hsl(h …)`/hex → its hue; else 0. */
export function colorToHue(color: string): number {
  if (color === FOREGROUND_COLOR) return INK_TRACK_VALUE
  const hsl = color.match(/^hsl\(\s*([\d.]+)/i)
  if (hsl) return Math.max(0, Math.min(360, Math.round(parseFloat(hsl[1]))))
  const hex = color.replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = Math.round(h * 60)
  return h < 0 ? h + 360 : h
}

export const MIN_PENS = 1
export const MAX_PENS = 8
const DEFAULT_SIZE = 2

const STORAGE_KEY = 'annotation-pens'
const LEGACY_COLORS_KEY = 'annotation-pen-colors'
const LEGACY_SIZES_KEY = 'annotation-pen-sizes'

/** Colours offered in the picker — also the source for a new pen's colour. */
export const PEN_PALETTE = [FOREGROUND_COLOR, '#808080', '#DD5555', '#EE8844', '#44AA66', '#5577DD', '#9966DD']

/** Today's defaults: two pens + two highlighters, in cyan and orange. Fixed ids
 *  (deterministic across SSR/CSR; ids only need to be unique within the list).
 *  Highlighters render translucent via highlightBackground() (hex → /0.35). */
export const DEFAULT_PENS: PenConfig[] = [
  { id: 'pen-1', color: '#2BB7EE', size: DEFAULT_SIZE, type: 'pen' },
  { id: 'pen-2', color: '#EE892B', size: DEFAULT_SIZE, type: 'pen' },
  { id: 'highlight-1', color: '#2BB7EE', size: DEFAULT_SIZE, type: 'highlight' },
  { id: 'highlight-2', color: '#EE892B', size: DEFAULT_SIZE, type: 'highlight' },
]

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `pen-${Math.random().toString(36).slice(2)}`
}

/** Pick the first palette colour not already used; fall back to cycling. */
export function nextPenColor(existing: string[]): string {
  const unused = PEN_PALETTE.find((c) => !existing.includes(c))
  return unused ?? PEN_PALETTE[existing.length % PEN_PALETTE.length]
}

// --- Pure transforms (used by the toolbar handlers + unit tests) ---

/** A highlighter's default colour — yellow, like a real highlighter. */
export const DEFAULT_HIGHLIGHT_COLOR = hueToColor(50)

export function addPen(pens: PenConfig[], type: PenType = 'pen'): PenConfig[] {
  if (pens.length >= MAX_PENS) return pens
  const color = type === 'highlight' ? DEFAULT_HIGHLIGHT_COLOR : nextPenColor(pens.map((p) => p.color))
  return [...pens, { id: genId(), color, size: DEFAULT_SIZE, type }]
}

export function removePen(pens: PenConfig[], id: string): PenConfig[] {
  if (pens.length <= MIN_PENS) return pens
  const next = pens.filter((p) => p.id !== id)
  return next.length === pens.length ? pens : next
}

export function reorderPens(pens: PenConfig[], orderedIds: string[]): PenConfig[] {
  const byId = new Map(pens.map((p) => [p.id, p]))
  const out: PenConfig[] = []
  for (const id of orderedIds) {
    const p = byId.get(id)
    if (p) {
      out.push(p)
      byId.delete(id)
    }
  }
  // Keep any pens not named in orderedIds (safety) in their original order.
  for (const p of pens) if (byId.has(p.id)) out.push(p)
  return out
}

export function setPenColor(pens: PenConfig[], id: string, color: string): PenConfig[] {
  return pens.map((p) => (p.id === id ? { ...p, color } : p))
}

export function setPenSize(pens: PenConfig[], id: string, size: number): PenConfig[] {
  return pens.map((p) => (p.id === id ? { ...p, size } : p))
}

// --- Validation + persistence ---

/** Coerce arbitrary parsed JSON into a valid, capped PenConfig[] (or []). */
export function sanitizePens(parsed: unknown): PenConfig[] {
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: PenConfig[] = []
  for (const item of parsed) {
    if (out.length >= MAX_PENS) break
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const color = typeof rec.color === 'string' ? rec.color : null
    if (!color) continue
    const size = typeof rec.size === 'number' && rec.size > 0 ? rec.size : DEFAULT_SIZE
    const type: PenType = rec.type === 'highlight' ? 'highlight' : 'pen'
    let id = typeof rec.id === 'string' && rec.id ? rec.id : genId()
    while (seen.has(id)) id = genId()
    seen.add(id)
    out.push({ id, color, size, type })
  }
  return out
}

/** Build PenConfig[] from the legacy `annotation-pen-colors`/`-sizes` tuples so
 *  returning users keep their customised pens (no reset to defaults). */
export function pensFromLegacy(colorsRaw: string | null, sizesRaw: string | null): PenConfig[] | null {
  if (!colorsRaw && !sizesRaw) return null
  let colors: unknown = null
  let sizes: unknown = null
  try { colors = colorsRaw ? JSON.parse(colorsRaw) : null } catch { /* ignore */ }
  try { sizes = sizesRaw ? JSON.parse(sizesRaw) : null } catch { /* ignore */ }
  const colorArr = Array.isArray(colors) ? colors : DEFAULT_PENS.map((p) => p.color)
  const sizeArr = Array.isArray(sizes) ? sizes : []
  const n = Math.min(Math.max(colorArr.length, 1), MAX_PENS)
  const out: PenConfig[] = []
  for (let i = 0; i < n; i++) {
    const color = typeof colorArr[i] === 'string' ? colorArr[i] : (DEFAULT_PENS[i]?.color ?? '#000000')
    const size = typeof sizeArr[i] === 'number' && sizeArr[i] > 0 ? sizeArr[i] : DEFAULT_SIZE
    out.push({ id: `pen-${i + 1}`, color, size, type: 'pen' })
  }
  return out.length ? out : null
}

/** Load the pen set: new format → legacy migration → defaults. */
export function loadPens(): PenConfig[] {
  if (typeof window === 'undefined') return DEFAULT_PENS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const pens = sanitizePens(JSON.parse(raw))
      if (pens.length) return pens
    }
    const legacy = pensFromLegacy(
      localStorage.getItem(LEGACY_COLORS_KEY),
      localStorage.getItem(LEGACY_SIZES_KEY),
    )
    if (legacy) return legacy
  } catch (e) {
    console.error('Error loading pens:', e)
  }
  return DEFAULT_PENS
}

export function savePens(pens: PenConfig[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pens))
  } catch (e) {
    console.error('Error saving pens:', e)
  }
}
