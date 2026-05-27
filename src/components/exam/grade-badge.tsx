'use client'

/**
 * Per-question grade shown inside the exam view. Reads the exam-review context:
 * - review mode (student): read-only "earned / max pts" pill + any teacher
 *   feedback for this question.
 * - grade mode (teacher): editable points (override) + revert-to-auto + a
 *   feedback text box.
 * Renders nothing when no review is active for this component.
 */

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useComponentReview } from '@/contexts/exam-review-context'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function GradeBadge({ componentId }: { componentId: string }) {
  const { active, mode, review, setOverride, setFeedback } = useComponentReview(componentId)
  const [draft, setDraft] = useState('')
  const [fb, setFb] = useState('')

  useEffect(() => {
    if (!review) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the editable draft to the loaded/overridden score
    setDraft(fmt(review.earned))
  }, [review?.earned, review?.componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!review) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync feedback draft to loaded value
    setFb(review.feedback ?? '')
  }, [review?.feedback, review?.componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist points edits on a short debounce, not just on blur — the number
  // input's spinner arrows (and ↑/↓ arrow keys) change the value WITHOUT
  // blurring, so a blur-only commit dropped those edits (no override, lost on
  // reload). Skips an empty field (revert is handled on blur) and a no-op equal
  // to the current score (avoids a commit loop with the sync effect above).
  useEffect(() => {
    if (!review || draft === '') return
    const v = Number(draft)
    if (!Number.isFinite(v) || v === review.earned) return
    const t = setTimeout(() => setOverride(v), 400)
    return () => clearTimeout(t)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist feedback on a debounce (typing). No-op when unchanged from the
  // loaded value (also breaks the save→reload→sync loop).
  useEffect(() => {
    if (!review) return
    if (fb === (review.feedback ?? '')) return
    const t = setTimeout(() => setFeedback(fb.trim() === '' ? null : fb), 600)
    return () => clearTimeout(t)
  }, [fb]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !review) return null

  const tone = review.earned >= review.max ? 'border-green-500/40 bg-green-500/10' : 'border-amber-500/40 bg-amber-500/10'

  if (mode === 'review') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium ${tone}`}>
          <span className="tabular-nums">{fmt(review.earned)} / {fmt(review.max)}</span>
          <span className="text-muted-foreground font-normal">pts</span>
        </div>
        {review.feedback && (
          <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Feedback</span>
            <p className="mt-0.5 whitespace-pre-wrap">{review.feedback}</p>
          </div>
        )}
      </div>
    )
  }

  // grade mode
  const commit = () => {
    const v = draft === '' ? null : Number(draft)
    if (v !== null && !Number.isFinite(v)) return
    if (v !== review.earned) setOverride(v)
  }
  return (
    <div className="mt-2 space-y-1.5">
      <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${tone}`}>
        <span className="text-xs text-muted-foreground">Points</span>
        <input
          type="number"
          step="0.1"
          className="w-14 h-7 rounded border bg-background px-1 text-right tabular-nums"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
        <span className="text-muted-foreground tabular-nums">/ {fmt(review.max)}</span>
        {review.overridden ? (
          <button
            title={`Revert to auto (${fmt(review.autoEarned)})`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setOverride(null)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">auto</span>
        )}
      </div>
      <textarea
        value={fb}
        onChange={(e) => setFb(e.target.value)}
        placeholder="Feedback for this question (shown to the student)…"
        rows={2}
        className="w-full max-w-md rounded border bg-background px-2 py-1 text-sm resize-y"
      />
    </div>
  )
}
