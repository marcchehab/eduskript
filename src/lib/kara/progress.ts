/**
 * Per-student Kara progress, shared across every page of a skript: best stars
 * per level and the evidence collected (shown on the evidence board). Stored
 * like the skript-wide python imports (`userDataService` with the skriptId as
 * page key), so it syncs like other user data. Without a skriptId (e.g. the
 * dashboard preview) nothing is stored.
 */

import { userDataService } from '@/lib/userdata'
import type { KaraEvidence } from './world'

export const KARA_PROGRESS_KEY = 'kara-progress'

export interface KaraSavedEvidence extends KaraEvidence {
  level: string
}

export interface KaraProgress {
  levels: Record<string, number>
  evidence: Record<string, KaraSavedEvidence>
}

const EMPTY: KaraProgress = { levels: {}, evidence: {} }

export async function loadKaraProgress(skriptId: string): Promise<KaraProgress> {
  const record = await userDataService.get<KaraProgress>(skriptId, KARA_PROGRESS_KEY)
  return { ...EMPTY, ...(record?.data ?? {}) }
}

/** Merge a finished run into the saved progress (stars only ever go up). */
export async function recordKaraResult(skriptId: string, level: string, stars: number, evidence: KaraEvidence[]): Promise<void> {
  const current = await loadKaraProgress(skriptId)
  // Unsolved runs (0 stars) only add evidence; they never create a level entry.
  const levels = stars > 0 ? { ...current.levels, [level]: Math.max(stars, current.levels[level] ?? 0) } : current.levels
  const next: KaraProgress = {
    levels,
    evidence: { ...current.evidence },
  }
  for (const e of evidence) next.evidence[e.id] = { ...e, level }
  const changed = next.levels[level] !== current.levels[level] || evidence.some(e => !current.evidence[e.id])
  if (changed) await userDataService.save(skriptId, KARA_PROGRESS_KEY, next, { immediate: true })
}

export function subscribeKaraProgress(skriptId: string, callback: (p: KaraProgress) => void): () => void {
  return userDataService.subscribe<KaraProgress>(skriptId, KARA_PROGRESS_KEY, data => callback({ ...EMPTY, ...data }))
}
