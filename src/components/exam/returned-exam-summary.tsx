'use client'

/**
 * Banner shown atop a student's returned exam (review mode): the overall grade
 * and total points. Reads the exam-review context; renders nothing until it's
 * loaded.
 */

import { Award } from 'lucide-react'
import { useExamReview } from '@/contexts/exam-review-context'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function ReturnedExamSummary() {
  const { mode, grade, totalEarned, totalMax, pageId } = useExamReview()
  // If the teacher takes the exam back to correct it, reload so the server drops
  // this student out of review mode (the grade hides until it's re-returned).
  useRealtimeEvents(
    ['exam-taken-back'],
    (event) => { if (event.pageId === pageId) window.location.reload() },
  )
  if (mode !== 'review' || grade === null) return null
  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-8 pt-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <Award className="w-6 h-6 text-primary" />
          <div>
            <div className="font-medium">Your exam has been returned</div>
            <div className="text-sm text-muted-foreground">
              Scores per question are shown below.
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums leading-none">{fmt(grade)}</div>
          <div className="text-xs text-muted-foreground">
            {fmt(totalEarned ?? 0)} / {fmt(totalMax ?? 0)} pts
          </div>
        </div>
      </div>
    </div>
  )
}
