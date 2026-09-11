'use client'

/**
 * Student feedback view for a returned exam: the Swiss grade, total points, and
 * a per-question score breakdown. Server-gated on returnedAt (the API 403s
 * before the teacher returns it). Ad-hoc teacher annotations/comments are
 * delivered separately when the student opens the exam page itself.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface ComponentResult {
  componentId: string
  label: string | null
  earned: number
  max: number
  answered: boolean
}
interface MyGrade {
  pageTitle: string
  submittedAt: string
  returnedAt: string
  grade: number
  totalEarned: number
  totalMax: number
  components: ComponentResult[]
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export default function MyExamFeedbackPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const { status } = useSession()
  const [grade, setGrade] = useState<MyGrade | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch(`/api/exams/${pageId}/my-grade`)
      .then(async (r) => {
        if (r.status === 403) throw new Error('This exam hasn’t been returned yet.')
        if (!r.ok) throw new Error('Could not load your feedback.')
        return r.json()
      })
      .then((j: MyGrade) => setGrade(j))
      .catch((e) => setError(e.message))
  }, [pageId, status])

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <BackLink />
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }
  if (!grade) return <div className="p-6 text-muted-foreground">Loading…</div>

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <BackLink />
      <div>
        <h1 className="text-2xl font-bold">{grade.pageTitle}</h1>
        <p className="text-sm text-muted-foreground">
          Returned {new Date(grade.returnedAt).toLocaleDateString()}
        </p>
      </div>

      <div className="rounded-lg border p-5 flex items-center justify-between bg-card">
        <div>
          <div className="text-sm text-muted-foreground">Grade</div>
          <div className="text-4xl font-bold tabular-nums">{fmt(grade.grade)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Points</div>
          <div className="text-2xl font-semibold tabular-nums">
            {fmt(grade.totalEarned)} / {fmt(grade.totalMax)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-4 py-2 font-medium">Question</th>
              <th className="px-4 py-2 font-medium text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {grade.components.map((c, i) => (
              <tr key={c.componentId} className="border-t">
                <td className="px-4 py-2">
                  {c.label || `Question ${i + 1}`}
                  {!c.answered && <span className="ml-2 text-xs text-muted-foreground">(not answered)</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(c.earned)} / {fmt(c.max)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/dashboard/my-exams" className="text-sm text-muted-foreground inline-flex items-center gap-1">
      <ArrowLeft className="w-4 h-4" /> My Exams
    </Link>
  )
}
