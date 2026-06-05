'use client'

/**
 * Per-question score shown inside the exam view. Reads the exam-review context:
 * - review mode (student): read-only "earned / max pts" pill + any teacher
 *   feedback for this question.
 * - grade mode (teacher): editable points (override) + revert-to-auto + a
 *   feedback text box.
 * Shows points (Punkte), not the 1-6 grade. Renders nothing when no review is
 * active for this component.
 */

import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useComponentReview } from '@/contexts/exam-review-context'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function ScoreBadge({ componentId }: { componentId: string }) {
  const { active, mode, review, setOverride, setFeedback } = useComponentReview(componentId)
  const [draft, setDraft] = useState('')
  const [fb, setFb] = useState('')
  // While a field is focused, DON'T overwrite its draft from a server reload:
  // the debounced save triggers a /review refetch, and syncing the (lagging)
  // server value back into a field you're typing in dropped your last letters.
  const ptsFocused = useRef(false)
  const fbFocused = useRef(false)

  useEffect(() => {
    if (!review || ptsFocused.current) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the editable draft to the loaded/overridden score
    setDraft(fmt(review.earned))
  }, [review?.earned, review?.componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!review || fbFocused.current) return
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
  // What clearing the override falls back to: AI score if present, else check.
  const underlying = review.aiEarned ?? review.autoEarned
  const underlyingLabel = review.aiEarned != null ? 'AI' : 'auto'
  return (
    <div className="mt-2 flex items-start gap-2">
      {/* Fixed width so the feedback box doesn't shift as the points value /
          auto-vs-revert affordance changes the badge's natural width. */}
      <div className="w-44 shrink-0 space-y-1">
        <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${tone}`}>
          <span className="text-xs text-muted-foreground">Points</span>
          <input
            type="number"
            step="0.1"
            className="w-12 h-7 rounded border bg-background px-1 text-right tabular-nums"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => { ptsFocused.current = true }}
            onBlur={() => { ptsFocused.current = false; commit() }}
          />
          <span className="text-muted-foreground tabular-nums">/ {fmt(review.max)}</span>
          {review.overridden ? (
            <button
              title={`Revert to ${underlyingLabel} (${fmt(underlying)})`}
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setOverride(null)}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground">{review.effectiveSource ?? 'auto'}</span>
          )}
        </div>
        {/* Per-source breakdown: the effective source is emphasised. */}
        <div className="flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground tabular-nums">
          <span className={review.effectiveSource === 'check' ? 'font-semibold text-foreground' : ''}>
            check {fmt(review.autoEarned)}
          </span>
          {review.aiEarned != null && (
            <span className={review.effectiveSource === 'ai' ? 'font-semibold text-foreground' : ''}>
              AI {fmt(review.aiEarned)}
            </span>
          )}
        </div>
      </div>
      <textarea
        value={fb}
        onChange={(e) => setFb(e.target.value)}
        onFocus={() => { fbFocused.current = true }}
        onBlur={() => { fbFocused.current = false }}
        placeholder="Feedback for this question (shown to the student)…"
        rows={2}
        className="flex-1 min-w-0 rounded border bg-background px-2 py-1 text-sm resize-y"
      />
    </div>
  )
}
