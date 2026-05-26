/**
 * Client helper for writing server-side checkpoints.
 *
 * Call sites: code editor's manual save, Python check runs, SQL verification
 * runs, Run-button presses, and text-quiz autosaves (kind 'autosave', exam
 * pages only — gives the teacher an answer-history timeline). Hand-in goes
 * through its own batched route (see /api/exams/[pageId]/hand-in).
 *
 * Errors are swallowed by design: a checkpoint failure (incl. 402 free-tier
 * gate) must never break the local save UX — IndexedDB has the data either
 * way.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('userdata:checkpoints')

// 'autosave' = a text-quiz answer snapshot taken on change. Unlike the other
// kinds it does NOT emit a teacher live-feed SSE event (it would fire on every
// debounced keystroke); the teacher reads the history on demand.
export type CheckpointKind = 'manual' | 'check' | 'handin' | 'run' | 'autosave'

export interface CheckpointPayload {
  pageId: string
  componentId: string
  kind: CheckpointKind
  payload: unknown
  label?: string
}

export interface PostCheckpointResult {
  /** Server-side checkpoint id when the POST succeeded; null on 402/error/network. */
  id: string | null
}

export async function postCheckpoint(input: CheckpointPayload): Promise<PostCheckpointResult> {
  try {
    const res = await fetch('/api/user-data/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 402) {
      // Free-tier teacher's class — silent no-op, mirrors sync engine behavior.
      return { id: null }
    }
    if (!res.ok) {
      log('Checkpoint POST failed', { status: res.status, kind: input.kind })
      return { id: null }
    }
    const json = await res.json().catch(() => null) as { created?: Array<{ id: string }> } | null
    return { id: json?.created?.[0]?.id ?? null }
  } catch (error) {
    log('Checkpoint POST threw', { error, kind: input.kind })
    return { id: null }
  }
}
