'use client'

/**
 * Exams section of the teacher's class page (dashboard/classes): one row per exam
 * of the class with handed-in / graded / returned counts and a link to the
 * grading table. Data: GET /api/classes/[id]/exams (see that route for what
 * "graded" means). Fetched once when the class is expanded; no live refresh.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface ClassExam {
  pageId: string
  title: string
  memberCount: number
  handedIn: number
  graded: number
  returned: number
  lastSubmittedAt: string | null
  gradingUrl: string
  examUrl: string | null
}

export function ClassExams({ classId }: { classId: string }) {
  const [exams, setExams] = useState<ClassExam[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/classes/${classId}/exams`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { exams: ClassExam[] }) => {
        if (!cancelled) setExams(data.exams)
      })
      .catch((err) => {
        console.error('Error loading class exams:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [classId])

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold flex items-center gap-2">
        <ClipboardList className="w-4 h-4" />
        Exams{exams ? ` (${exams.length})` : ''}
      </Label>
      {error ? (
        <p className="text-sm text-muted-foreground">Could not load exams.</p>
      ) : exams === null ? (
        <p className="text-sm text-muted-foreground">Loading exams...</p>
      ) : exams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No exams yet. An exam shows up here once you unlock it for this class or a student hands it in.
        </p>
      ) : (
        <ul className="divide-y border rounded-lg bg-background">
          {exams.map((exam) => {
            const toGrade = exam.handedIn - exam.graded
            return (
              <li key={exam.pageId} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{exam.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Handed in {exam.handedIn}/{exam.memberCount} · Graded {exam.graded} · Returned {exam.returned}
                    {toGrade > 0 && (
                      <span className="ml-2 text-amber-700 dark:text-amber-400">{toGrade} to grade</span>
                    )}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild className="gap-1 shrink-0">
                  <Link href={exam.gradingUrl}>
                    <ClipboardList className="w-3.5 h-3.5" />
                    Grade
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
