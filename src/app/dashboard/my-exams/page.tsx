'use client'

/**
 * Student "My Exams" — lists exams the student has handed in and their state.
 * A returned exam links to the feedback view. Refreshes live on the
 * `exam-returned` SSE event so a grade appears the moment the teacher returns it.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ClipboardCheck, ChevronRight } from 'lucide-react'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

interface ExamRow {
  pageId: string
  title: string
  submittedAt: string
  returnedAt: string | null
  status: 'submitted' | 'returned'
  examUrl: string | null
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function MyExamsPage() {
  const { status } = useSession()
  const [exams, setExams] = useState<ExamRow[] | null>(null)

  const load = useCallback(() => {
    fetch('/api/student/my-exams')
      .then((r) => (r.ok ? r.json() : { exams: [] }))
      .then((j) => setExams(j.exams ?? []))
      .catch(() => setExams([]))
  }, [])

  useEffect(() => {
    if (status === 'authenticated') load()
  }, [status, load])

  useRealtimeEvents(['exam-returned'], load, { enabled: status === 'authenticated' })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6" /> My Exams
        </h1>
        <p className="text-muted-foreground">Exams you’ve handed in. Returned exams show your feedback.</p>
      </div>

      {exams === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : exams.length === 0 ? (
        <p className="text-muted-foreground">You haven’t handed in any exams yet.</p>
      ) : (
        <ul className="space-y-2">
          {exams.map((e) => {
            const inner = (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4 bg-card">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Handed in {fmtDate(e.submittedAt)}
                    {e.returnedAt && ` · returned ${fmtDate(e.returnedAt)}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {e.status === 'returned' ? (
                    <span className="rounded px-2 py-0.5 text-xs bg-green-500/15 text-green-700 dark:text-green-400">
                      Returned
                    </span>
                  ) : (
                    <span className="rounded px-2 py-0.5 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      Awaiting correction
                    </span>
                  )}
                  {e.status === 'returned' && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>
            )
            // Returned → open the actual exam read-only (review mode), where
            // the student sees their answers + per-question scores. Fall back to
            // the dashboard score summary if the exam URL can't be resolved.
            const href = e.examUrl ?? `/dashboard/my-exams/${e.pageId}`
            return (
              <li key={e.pageId}>
                {e.status === 'returned' ? (
                  <Link href={href} className="block hover:opacity-90">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
