'use client'

/**
 * Archived exams of a class (ExamRecord, src/lib/exam-records.ts) on the
 * teacher's class page: one group per exam, one row per student with grade,
 * points and a link to the record. Data: GET /api/classes/[id]/exam-records.
 * Student emails come from the teacher's local mapping (IndexedDB) when there,
 * else the email stored with consent, else the name.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Archive } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'

interface RecordRow {
  id: string
  pageId: string
  pageTitle: string
  studentName: string | null
  studentPseudonym: string | null
  studentEmail: string | null
  returnedAt: string | null
  score: number | null
  maxScore: number | null
  grade: number | null
  retainUntil: string
}

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '–')

export function ClassExamRecords({ classId }: { classId: string }) {
  const [records, setRecords] = useState<RecordRow[] | null>(null)
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/classes/${classId}/exam-records`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { records: RecordRow[] }) => { if (!cancelled) setRecords(data.records) })
      .catch(() => { if (!cancelled) setError(true) })
    getReverseMappingsForClass(classId).then((m) => { if (!cancelled) setEmails(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [classId])

  const groups = new Map<string, RecordRow[]>()
  for (const r of records ?? []) {
    const list = groups.get(r.pageId) ?? []
    list.push(r)
    groups.set(r.pageId, list)
  }

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold flex items-center gap-2">
        <Archive className="w-4 h-4" />
        Archived exams{records ? ` (${records.length})` : ''}
      </Label>
      {error ? (
        <p className="text-sm text-muted-foreground">Could not load archived exams.</p>
      ) : records === null ? (
        <p className="text-sm text-muted-foreground">Loading archived exams...</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No archived exams.</p>
      ) : (
        <div className="space-y-3">
          {[...groups.values()].map((rows) => (
            <div key={rows[0].pageId} className="border rounded-lg bg-background">
              <p className="px-3 py-2 font-medium border-b">{rows[0].pageTitle}</p>
              <ul className="divide-y text-sm">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/dashboard/exam-records/${r.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2 hover:bg-muted/50">
                      <span className="flex-1 min-w-0 truncate">
                        {(r.studentPseudonym && emails[r.studentPseudonym]) || r.studentEmail || r.studentName || 'Unknown student'}
                      </span>
                      <span className="tabular-nums">{r.grade != null ? `Grade ${r.grade.toFixed(1)}` : '–'}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {r.score ?? '–'}/{r.maxScore ?? '–'} pts
                      </span>
                      <span className="text-xs text-muted-foreground" title={`Kept until ${date(r.retainUntil)}`}>
                        {r.returnedAt ? `Returned ${date(r.returnedAt)}` : 'Not returned'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
