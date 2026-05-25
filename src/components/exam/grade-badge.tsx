'use client'

/**
 * Per-question grade shown inside the exam view. Reads the exam-review context:
 * - review mode (student): read-only "earned / max pts" pill.
 * - grade mode (teacher): editable points (override) + revert-to-auto.
 * Renders nothing when no review is active for this component.
 */

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useComponentReview } from '@/contexts/exam-review-context'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function GradeBadge({ componentId }: { componentId: string }) {
  const { active, mode, review, setOverride } = useComponentReview(componentId)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!review) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the editable draft to the loaded/overridden score
    setDraft(fmt(review.earned))
  }, [review?.earned, review?.componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !review) return null

  const tone = review.earned >= review.max ? 'border-green-500/40 bg-green-500/10' : 'border-amber-500/40 bg-amber-500/10'

  if (mode === 'review') {
    return (
      <div className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium ${tone}`}>
        <span className="tabular-nums">{fmt(review.earned)} / {fmt(review.max)}</span>
        <span className="text-muted-foreground font-normal">pts</span>
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
    <div className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${tone}`}>
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
  )
}
