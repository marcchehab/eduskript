/**
 * One-off "neutral port" of stored section ids (scripts/port-legacy-section-ids.ts).
 *
 * Section ids changed on 2026-11-19 (rehype-plugins/heading-section-ids.ts, ID
 * FORMAT). Strokes, snaps and sticky notes stored before that carry legacy ids,
 * which the renderer resolves through the `data-legacy-section-ids` map
 * (findSectionElement). This module rewrites a stored legacy id to the current
 * id the map gives for the page's CURRENT content, i.e. to the id of the very
 * element the legacy id resolves to today. Points, sectionOffsetY and every
 * other field stay as they are, so nothing moves.
 *
 * Left untouched:
 * - ids that are already current (contain `@`, or are `paper-top`), `unknown`,
 *   empty/missing ids
 * - `spacer-<id>[-end]` (spacer anchors are injected client-side, never in the map)
 * - orphans: legacy ids not in the map (they did not resolve before either)
 *
 * The map is built with the real compile path (compileMarkdown), mirroring
 * ServerMarkdownRenderer: publicContent(), then one compile per `<next-stage>`
 * stage (or one for the whole page), maps merged first-wins in document order
 * like readLegacySectionIds. Limitation: the client-side renderer
 * (markdown-renderer.client.tsx, editor preview) compiles the full content
 * without publicContent(); if teacher-only blocks contain anchored elements,
 * legacy counters there differ. Students only see the public render.
 */
import { isValidElement, type ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { publicContent } from '@/lib/teacher-content'
import { hasStages, splitStages } from '@/lib/markdown-stages'
import { LEGACY_SECTION_IDS_ATTR } from '@/lib/annotations/reposition-strokes'

export type LegacyMap = Map<string, string>

/** Collects the legacy maps of a compiled React tree in document order, first wins. O(nodes). */
function collectMaps(node: ReactNode, into: LegacyMap): void {
  if (Array.isArray(node)) {
    for (const child of node) collectMaps(child, into)
    return
  }
  if (!isValidElement(node)) return
  const props = node.props as Record<string, unknown>
  const raw = props[LEGACY_SECTION_IDS_ATTR]
  if (typeof raw === 'string') {
    try {
      for (const [legacy, current] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
        if (typeof current === 'string' && !into.has(legacy)) into.set(legacy, current)
      }
    } catch {
      // Malformed map: same as readLegacySectionIds, its ids stay unresolved.
    }
  }
  collectMaps(props.children as ReactNode, into)
}

/**
 * Legacy → current section id map of `content` as the public page renders it.
 * `content` is the raw stored page content (publicContent() is applied here).
 */
export async function legacySectionIdMap(content: string, opts: { fileNames?: string[] } = {}): Promise<LegacyMap> {
  const pub = publicContent(content)
  const parts = hasStages(pub) ? splitStages(pub).stages : [pub]
  const map: LegacyMap = new Map()
  for (const part of parts) {
    collectMaps(await compileMarkdown(part, { fileNames: opts.fileNames }), map)
  }
  return map
}

export type ItemStatus = 'rewritten' | 'current' | 'orphan' | 'spacer' | 'unanchored'

/** What the port does with one stored id. Pure. */
export function classifySectionId(id: unknown, map: LegacyMap): { status: ItemStatus; next?: string } {
  if (typeof id !== 'string' || id === '' || id === 'unknown') return { status: 'unanchored' }
  if (id === 'paper-top' || id.includes('@')) return { status: 'current' }
  if (/^spacer-/.test(id)) return { status: 'spacer' }
  const next = map.get(id)
  if (next === undefined) return { status: 'orphan' }
  if (next === id) return { status: 'current' }
  return { status: 'rewritten', next }
}

export type PortCounts = Record<ItemStatus, number>
const emptyCounts = (): PortCounts => ({ rewritten: 0, current: 0, orphan: 0, spacer: 0, unanchored: 0 })

/** Section-anchored adapters and where their items live. */
export const PORTED_ADAPTERS = ['annotations', 'snaps', 'sticky-notes'] as const
export type PortedAdapter = (typeof PORTED_ADAPTERS)[number]

export interface PortResult {
  /** Same object as the input when nothing changed. */
  data: unknown
  changed: boolean
  counts: PortCounts
  /** Orphaned legacy ids (distinct). */
  orphanIds: string[]
  /** Set when the stored payload could not be parsed; data is returned unchanged. */
  error?: string
}

function portItems(items: unknown[], map: LegacyMap, counts: PortCounts, orphans: Set<string>): { items: unknown[]; changed: boolean } {
  let changed = false
  const out = items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const sid = (item as { sectionId?: unknown }).sectionId
    const { status, next } = classifySectionId(sid, map)
    counts[status]++
    if (status === 'orphan') orphans.add(String(sid))
    if (status !== 'rewritten') return item
    changed = true
    return { ...(item as object), sectionId: next }
  })
  return { items: out, changed }
}

/**
 * Rewrites legacy section ids in one user_data payload. Pure; idempotent (a
 * rewritten id contains `@` and is classified `current` on the next run).
 * annotations: `data.canvasData` is a JSON string of strokes; it is re-serialized
 * only when a stroke changed (JSON.stringify of the parsed array; numbers keep
 * their value). snaps: `data.snaps[]`. sticky-notes: `data.notes[]`.
 */
export function portUserData(adapter: string, data: unknown, map: LegacyMap): PortResult {
  const counts = emptyCounts()
  const orphans = new Set<string>()
  const result = (next: unknown, changed: boolean, error?: string): PortResult => ({
    data: changed ? next : data, changed, counts, orphanIds: [...orphans], ...(error ? { error } : {}),
  })
  if (!data || typeof data !== 'object') return result(data, false)
  const obj = data as Record<string, unknown>

  if (adapter === 'annotations') {
    const raw = obj.canvasData
    if (typeof raw !== 'string' || raw === '') return result(data, false)
    let strokes: unknown
    try {
      strokes = JSON.parse(raw)
    } catch (e) {
      return result(data, false, `canvasData: ${(e as Error).message}`)
    }
    if (!Array.isArray(strokes)) return result(data, false, 'canvasData is not an array')
    const { items, changed } = portItems(strokes, map, counts, orphans)
    return result(changed ? { ...obj, canvasData: JSON.stringify(items) } : data, changed)
  }

  const key = adapter === 'snaps' ? 'snaps' : adapter === 'sticky-notes' ? 'notes' : undefined
  if (!key || !Array.isArray(obj[key])) return result(data, false)
  const { items, changed } = portItems(obj[key] as unknown[], map, counts, orphans)
  return result(changed ? { ...obj, [key]: items } : data, changed)
}

/** content + data → ported data (builds the map, then {@link portUserData}). */
export async function portUserDataForContent(
  adapter: string,
  data: unknown,
  content: string,
  opts: { fileNames?: string[] } = {},
): Promise<PortResult> {
  return portUserData(adapter, data, await legacySectionIdMap(content, opts))
}
