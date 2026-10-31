/**
 * Shared plugin lists (leaderboards). A teacher opts in per embedding:
 * `<plugin src="…" share="class" />` shares within the student's classes,
 * `share="toplist-logarithms"` shares into a named list across all classes of
 * the site. `<leaderboard source="…" />` shows a list; with collect="page" it
 * also collects the scores of every component on its page that has points.
 *
 * Stored as UserData rows, one per student and embedding: adapter
 * 'plugin-share', itemId = list name, targetType 'plugin', targetId =
 * `pageId:componentId`. A student in two classes has one row and appears in
 * both class lists.
 *
 * Limitations:
 * - Values come from the browser, so a student can forge them, up to MAX_VALUE
 *   per value and MAX_LIST_ROWS rows per list. componentId is not checked
 *   against the page: generated ids (editors, questions and AI feedback without
 *   id) are not in the markdown. Fine for a leaderboard, not for grades.
 * - Classes belong to personal sites, so org sites have no members and their
 *   lists stay empty.
 *
 * @see src/app/api/plugin-share/route.ts
 * @see src/components/markdown/leaderboard.tsx
 */

export const PLUGIN_SHARE_ADAPTER = 'plugin-share'
export const PLUGIN_SHARE_TARGET = 'plugin'
/** Reserved list name: the viewer's class instead of a named list. */
export const CLASS_LIST = 'class'
/** Window event fired after a publish, so leaderboards on the page refetch. */
export const PLUGIN_SHARE_UPDATED = 'plugin-share-updated'
/** Window event fired by scored components; leaderboards with collect="page" listen. */
export const PAGE_SCORE = 'page-score'

export interface PageScore {
  componentId: string
  earned: number
}

/** Tell a collecting leaderboard on this page about a score. No listener, no effect. */
export function reportScore(score: PageScore) {
  window.dispatchEvent(new CustomEvent<PageScore>(PAGE_SCORE, { detail: score }))
}

export type KeepMode = 'best' | 'last'
export type ShareValues = Record<string, number>

export interface ShareEntry {
  rank: number
  nickname: string
  value: number
  isSelf: boolean
  /** Only for the site owner, and `email` only with the student's identity consent. */
  studentId?: string
  email?: string | null
}

export interface ShareResults {
  entries: ShareEntry[]
  /** The viewer's own entry, also when it is outside the limit. */
  self: ShareEntry | null
  /** Set for source="class": the classes the viewer can pick from. */
  classes: { id: string; name: string }[]
  classId: string | null
  /** False when the viewer is neither site owner nor in one of its classes. */
  member: boolean
  /** The viewer's own nickname (User.name), null when they have no membership. */
  nickname: string | null
}

const MAX_VALUE_KEYS = 10
/** Values outside 0..MAX_VALUE are dropped, so a sum stays finite and displayable. */
export const MAX_VALUE = 1_000_000
/** Rows per student and list; a course collecting across pages stays far below. */
export const MAX_LIST_ROWS = 200

export function isValidListName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)
}

export function parseKeep(keep: unknown): KeepMode {
  return keep === 'last' ? 'last' : 'best'
}

/** Numbers from 0 to MAX_VALUE under short keys; null when nothing valid remains. */
export function sanitizeValues(values: unknown): ShareValues | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const out: ShareValues = {}
  for (const [k, v] of Object.entries(values)) {
    if (Object.keys(out).length >= MAX_VALUE_KEYS) break
    if (/^[a-zA-Z0-9_-]{1,32}$/.test(k) && typeof v === 'number' && v >= 0 && v <= MAX_VALUE) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/** `best` keeps the higher number per key; keys not sent again stay. */
export function mergeValues(prev: ShareValues | null, next: ShareValues, keep: KeepMode): ShareValues {
  if (!prev) return next
  const out = { ...prev }
  for (const [k, v] of Object.entries(next)) {
    out[k] = keep === 'best' && typeof prev[k] === 'number' ? Math.max(prev[k], v) : v
  }
  return out
}

/** Sums `key` per user over their rows (several embeddings can feed one list). */
export function sumByUser(rows: { userId: string; data: unknown }[], key: string): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const v = (row.data as ShareValues | null)?.[key]
    if (typeof v === 'number') totals.set(row.userId, (totals.get(row.userId) ?? 0) + v)
  }
  return totals
}

/** Highest first; equal values share a rank (1, 2, 2, 4). Ties sort by id for a stable order. */
export function rankTotals(totals: Map<string, number>): { userId: string; value: number; rank: number }[] {
  const sorted = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  let rank = 0
  return sorted.map(([userId, value], i) => {
    if (i === 0 || value !== sorted[i - 1][1]) rank = i + 1
    return { userId, value, rank }
  })
}
