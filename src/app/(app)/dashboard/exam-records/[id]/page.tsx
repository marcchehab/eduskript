'use client'

/**
 * One archived exam (ExamRecord, src/lib/exam-records.ts), read-only: header
 * with grade and dates, per task the points, feedback and the submitted answer
 * as text, the exam log and the markdown of the version handed in. Data: GET
 * /api/exam-records/[id]; "Download" saves the full record as JSON.
 *
 * Routed at /dashboard/exam-records/[id].
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ExamRecordPayload } from '@/lib/exam-records'

interface ExamRecordView {
  id: string
  pageTitle: string
  className: string | null
  studentName: string | null
  studentEmail: string | null
  studentPseudonym: string | null
  submittedAt: string | null
  returnedAt: string | null
  score: number | null
  maxScore: number | null
  grade: number | null
  retainUntil: string
  payload: ExamRecordPayload
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '–')

export default function ExamRecordPage() {
  const { id } = useParams<{ id: string }>()
  const [record, setRecord] = useState<ExamRecordView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/exam-records/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { record: ExamRecordView }) => setRecord(d.record))
      .catch(() => setError(true))
  }, [id])

  if (error) return <div className="container mx-auto p-6"><p>Archived exam not found.</p></div>
  if (!record) return <div className="container mx-auto p-6"><p>Loading...</p></div>

  const { payload } = record
  return (
    <div className="container mx-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard/classes" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Classes
          </Link>
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <a href={`/api/exam-records/${record.id}?download=1`}>
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-bold">{record.pageTitle}</h1>
          <p className="text-muted-foreground">
            {record.studentEmail || record.studentName || 'Unknown student'}
            {record.className && ` · ${record.className}`}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div><p className="text-muted-foreground">Grade</p><p className="text-lg font-semibold">{record.grade?.toFixed(1) ?? '–'}</p></div>
          <div><p className="text-muted-foreground">Points</p><p className="text-lg font-semibold">{record.score ?? '–'} / {record.maxScore ?? '–'}</p></div>
          <div><p className="text-muted-foreground">Kept until</p><p>{new Date(record.retainUntil).toLocaleDateString()}</p></div>
          <div><p className="text-muted-foreground">Handed in</p><p>{when(record.submittedAt)}</p></div>
          <div><p className="text-muted-foreground">Returned</p><p>{when(record.returnedAt)}</p></div>
          {record.studentPseudonym && (
            <div><p className="text-muted-foreground">Pseudonym</p><p className="font-mono text-xs break-all">{record.studentPseudonym}</p></div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Tasks</h2>
          {payload.scores.components.map((c) => {
            const answer = payload.answers[c.componentId]?.text ?? ''
            return (
              <div key={c.componentId} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{c.label || c.componentId}</p>
                  <p className="tabular-nums text-sm">{c.earned} / {c.max} pts</p>
                </div>
                {answer.trim()
                  ? <pre className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-2 overflow-x-auto">{answer}</pre>
                  : <p className="text-sm text-muted-foreground">No answer.</p>}
                {c.feedback && <p className="text-sm"><span className="text-muted-foreground">Feedback: </span>{c.feedback}</p>}
              </div>
            )
          })}
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Exam log</h2>
          <ul className="text-sm space-y-1">
            {payload.log.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-muted-foreground tabular-nums">{when(l.occurredAt)}</span>
                <span>{l.event}</span>
                {l.score != null && <span className="text-muted-foreground">{l.score} pts</span>}
              </li>
            ))}
          </ul>
        </div>

        <details className="border rounded-lg p-3">
          <summary className="cursor-pointer font-medium">
            {payload.pageVersion != null ? `Exam page, version ${payload.pageVersion} as handed in (markdown)` : 'Exam page at archive time (markdown)'}
          </summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap overflow-x-auto">{payload.content}</pre>
        </details>
      </div>
    </div>
  )
}
