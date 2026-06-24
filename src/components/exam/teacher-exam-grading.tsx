'use client'

/**
 * Teacher-side in-exam grading. Mounted on the exam page for the author. When
 * the teacher selects a student (via ClassToolbar / StudentNavigator), the
 * ExamReviewProvider activates in 'grade' mode so every question shows that
 * student's answer + an editable score; a fixed bar offers Return (this
 * student) and Return all (the class). Inert until a class is selected.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import { Send, Loader2, Play, Wand2 } from 'lucide-react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useLayout } from '@/contexts/layout-context'
import { ExamReviewProvider, useExamReview } from '@/contexts/exam-review-context'
import { runChecksForStudents } from '@/lib/scoring/run-checks.client'
import { Button } from '@/components/ui/button'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { AiScoringModal } from '@/components/dashboard/ai-scoring-modal'

interface AiQuestion {
  componentId: string
  kind: 'quiz' | 'python'
  questionType: string | null
  label: string | null
  maxPoints: number | null
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function TeacherExamGrading({
  pageId,
  enabled,
  children,
}: {
  pageId: string
  enabled: boolean
  children: React.ReactNode
}) {
  const { selectedStudent, selectedClass, isTeacher, setSelectedStudent } = useTeacherClass()
  const studentId = enabled && isTeacher ? selectedStudent?.id ?? null : null

  // Preselect a student from ?student= (the grading-table link), once. The
  // roster/toolbar refines the display name; the grade view only needs the id.
  const search = useSearchParams()
  const appliedParamRef = useRef(false)
  useEffect(() => {
    if (appliedParamRef.current || !enabled || !isTeacher) return
    const sid = search.get('student')
    if (sid && !selectedStudent) {
      appliedParamRef.current = true
      setSelectedStudent({ id: sid, displayName: 'Student' })
    }
  }, [search, enabled, isTeacher, selectedStudent, setSelectedStudent])

  return (
    <ExamReviewProvider pageId={pageId} mode="grade" studentId={studentId}>
      {children}
      {enabled && isTeacher && selectedClass && (
        <GradingBar
          pageId={pageId}
          classId={selectedClass.id}
          studentId={selectedStudent?.id ?? null}
          studentName={selectedStudent?.displayName ?? null}
        />
      )}
    </ExamReviewProvider>
  )
}

function GradingBar({
  pageId,
  classId,
  studentId,
  studentName,
}: {
  pageId: string
  classId: string
  studentId: string | null
  studentName: string | null
}) {
  const dialog = useAlertDialog()
  const { runningChecks, rerunChecks, refreshGrades, totalEarned, totalMax, grade, loadedStudentId, returnedToStudent, examHasReturned } = useExamReview()
  // Only trust the totals when they were loaded for the currently-selected student
  // (during a switch the previous student's totals linger until the refetch lands).
  const totalsForCurrent = loadedStudentId === studentId
  const { sidebarWidth } = useLayout()
  const [busy, setBusy] = useState(false)
  const [runAll, setRunAll] = useState<{ done: number; total: number } | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiData, setAiData] = useState<{ questions: AiQuestion[]; studentIds: string[]; studentLabels: Record<string, string> } | null>(null)

  // Load the class roster + question list, then open the AI scoring modal. The
  // rubric is per-exam; scoring runs for the whole class regardless of which
  // student is currently selected.
  const openAiScoring = async () => {
    try {
      const res = await fetch(`/api/exams/${pageId}/grading?classId=${classId}`)
      const j = await res.json()
      const handedIn = (j.students ?? []).filter((s: { status: string }) => s.status !== 'not_started')
      const studentIds: string[] = handedIn.map((s: { studentId: string }) => s.studentId)
      const studentLabels: Record<string, string> = Object.fromEntries(
        handedIn.map((s: { studentId: string; email?: string | null; name?: string | null; pseudonym?: string | null }) => [
          s.studentId,
          s.email || s.name || s.pseudonym || s.studentId,
        ]),
      )
      setAiData({ questions: j.questions ?? [], studentIds, studentLabels })
      setAiOpen(true)
    } catch {
      dialog.showError('Could not load exam data for AI scoring.')
    }
  }

  // Return or take back (un-return). Both append an event; take-back is the
  // explicit unlock a teacher uses before correcting a returned score.
  const act = (endpoint: 'return' | 'take-back', body: object, label: string) => {
    setBusy(true)
    fetch(`/api/exams/${pageId}/grading/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((j) =>
        endpoint === 'return'
          ? dialog.showSuccess(`Returned ${j.returned ?? 0} exam(s).`, label)
          : dialog.showSuccess(`Took back ${j.takenBack ?? 0} exam(s).`, label),
      )
      .catch(() => dialog.showError(endpoint === 'return' ? 'Could not return.' : 'Could not take back.'))
      .finally(() => {
        setBusy(false)
        refreshGrades() // reflect the new lock state on the selected student
      })
  }

  // Re-run code checks for every submitted student in the class, on this device.
  const runAllChecks = async () => {
    try {
      const res = await fetch(`/api/exams/${pageId}/grading?classId=${classId}`)
      const j = await res.json()
      const ids: string[] = (j.students ?? [])
        .filter((s: { status: string }) => s.status !== 'not_started')
        .map((s: { studentId: string }) => s.studentId)
      if (ids.length === 0) {
        dialog.showInfo('No handed-in exams to check yet.')
        return
      }
      setRunAll({ done: 0, total: ids.length })
      await runChecksForStudents(pageId, ids, (done, total) => setRunAll({ done, total }))
      dialog.showSuccess(`Ran code checks for ${ids.length} student(s). Re-select a student to see updated scores.`, 'Checks complete')
    } catch {
      dialog.showError('Could not run all checks.')
    } finally {
      setRunAll(null)
    }
  }

  return (
    <>
      {/* Portal to <body> so `fixed` pins to the VIEWPORT — the exam page has
          transformed ancestors (zoom/pan) that would otherwise capture `fixed`
          and make the bar scroll with the page. Same trick as the annotation
          toolbar. */}
      {typeof window !== 'undefined' && createPortal(
      <div
        className="fixed top-8 z-50 flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
        // Center within the CONTENT area (viewport minus sidebar), like the
        // annotation toolbar — not the raw viewport.
        style={{ left: `calc(${sidebarWidth}px + (100% - ${sidebarWidth}px) / 2)`, transform: 'translateX(-50%)' }}
      >
        <span className="px-1 text-xs text-muted-foreground">Grading</span>
        {studentId && totalsForCurrent && totalMax != null && (
          <span className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-0.5 text-sm tabular-nums">
            <span className="font-medium">{fmt(totalEarned ?? 0)} / {fmt(totalMax)}</span>
            <span className="text-xs text-muted-foreground">pts</span>
            {grade != null && (
              <span className="ml-1 border-l border-border pl-2 font-semibold">{fmt(grade)}</span>
            )}
          </span>
        )}
        {studentId && !totalsForCurrent && (
          <span className="rounded-md bg-muted/60 px-2.5 py-0.5 text-sm text-muted-foreground">…</span>
        )}
        {studentId && totalsForCurrent && returnedToStudent && (
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Returned</span>
        )}
        {studentId && (
          <Button size="sm" variant="ghost" disabled={runningChecks} onClick={() => rerunChecks()} title="Re-run this student's code checks on this device">
            {runningChecks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!!runAll}
          onClick={runAllChecks}
          title="Re-run every submitted student's code checks"
        >
          {runAll ? (
            <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Checks {runAll.done}/{runAll.total}</>
          ) : (
            <><Play className="w-4 h-4 mr-1.5" />Run all checks</>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={openAiScoring}
          disabled={examHasReturned}
          title={examHasReturned ? 'Locked — a returned exam exists. Take it back to re-score.' : 'Generate scoring rubrics and AI-score the class'}
        >
          <Wand2 className="w-4 h-4 mr-1.5" />AI scoring
        </Button>
        {studentId && (
          returnedToStudent ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                dialog.showConfirm(
                  `Take back ${studentName || 'this student'}'s exam? Their grade hides until you return it again; their scores are kept.`,
                  () => act('take-back', { studentId }, 'Took back'),
                  { title: 'Take back exam', confirmText: 'Take back' },
                )
              }
            >
              Take back {studentName ? studentName.split(' ')[0] : 'student'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                dialog.showConfirm(
                  `Return this exam to ${studentName || 'this student'}? They'll see their grade and feedback.`,
                  () => act('return', { studentId }, 'Returned'),
                  { title: 'Return exam', confirmText: 'Return' },
                )
              }
            >
              Return {studentName ? studentName.split(' ')[0] : 'student'}
            </Button>
          )
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            dialog.showConfirm(
              'Return the graded exam to every student in this class who handed in?',
              () => act('return', { all: true, classId }, 'Returned all'),
              { title: 'Return all', confirmText: 'Return all' },
            )
          }
        >
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Return all
        </Button>
        {examHasReturned && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Take back every returned exam in this class"
            onClick={() =>
              dialog.showConfirm(
                'Take back every returned exam in this class? Grades hide until you return them again; scores are kept.',
                () => act('take-back', { all: true, classId }, 'Took back all'),
                { title: 'Take back all', confirmText: 'Take back all' },
              )
            }
          >
            Take back all
          </Button>
        )}
      </div>,
        document.body,
      )}
      <AlertDialogModal
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        showCancel={dialog.showCancel}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        destructive={dialog.destructive}
      />
      {aiData && (
        <AiScoringModal
          open={aiOpen}
          onOpenChange={setAiOpen}
          pageId={pageId}
          questions={aiData.questions}
          studentIds={aiData.studentIds}
          studentLabels={aiData.studentLabels}
          onScored={refreshGrades}
        />
      )}
    </>
  )
}
