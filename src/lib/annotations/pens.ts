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
 * `type` is forward-compatible for Phase 2 (a text highlighter pen); only
 * 'pen' exists today.
 */

export type PenType = 'pen'

export interface PenConfig {
  id: string
  color: string
  size: number
  type: PenType
}

export const MIN_PENS = 1
export const MAX_PENS = 8
const DEFAULT_SIZE = 2

const STORAGE_KEY = 'annotation-pens'
const LEGACY_COLORS_KEY = 'annotation-pen-colors'
const LEGACY_SIZES_KEY = 'annotation-pen-sizes'

/** Colours offered in the picker — also the source for a new pen's colour. */
export const PEN_PALETTE = ['#000000', '#808080', '#DD5555', '#EE8844', '#44AA66', '#5577DD', '#9966DD']

/** Today's defaults: black / red / blue at size 2. Fixed ids (deterministic
 *  across SSR/CSR; ids only need to be unique within the list). */
export const DEFAULT_PENS: PenConfig[] = [
  { id: 'pen-1', color: '#000000', size: DEFAULT_SIZE, type: 'pen' },
  { id: 'pen-2', color: '#FF0000', size: DEFAULT_SIZE, type: 'pen' },
  { id: 'pen-3', color: '#0000FF', size: DEFAULT_SIZE, type: 'pen' },
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

export function addPen(pens: PenConfig[]): PenConfig[] {
  if (pens.length >= MAX_PENS) return pens
  return [...pens, { id: genId(), color: nextPenColor(pens.map((p) => p.color)), size: DEFAULT_SIZE, type: 'pen' }]
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
    let id = typeof rec.id === 'string' && rec.id ? rec.id : genId()
    while (seen.has(id)) id = genId()
    seen.add(id)
    out.push({ id, color, size, type: 'pen' })
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
