'use client'

/**
 * Teacher-side in-exam grading. Mounted on the exam page for the author. When
 * the teacher selects a student (via ClassToolbar / StudentNavigator), the
 * ExamReviewProvider activates in 'grade' mode so every question shows that
 * student's answer + an editable score; a fixed bar offers Return (this
 * student) and Return all (the class). Inert until a class is selected.
 */

import { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { ExamReviewProvider } from '@/contexts/exam-review-context'
import { Button } from '@/components/ui/button'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'

export function TeacherExamGrading({
  pageId,
  enabled,
  children,
}: {
  pageId: string
  enabled: boolean
  children: React.ReactNode
}) {
  const { selectedStudent, selectedClass, isTeacher } = useTeacherClass()
  const studentId = enabled && isTeacher ? selectedStudent?.id ?? null : null

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
  const [busy, setBusy] = useState(false)

  const post = (body: object, label: string) => {
    setBusy(true)
    fetch(`/api/exams/${pageId}/grading/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((j) => dialog.showSuccess(`Returned ${j.returned ?? 0} exam(s).`, label))
      .catch(() => dialog.showError('Could not return.'))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="px-1 text-xs text-muted-foreground">Grading</span>
        {studentId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              dialog.showConfirm(
                `Return this exam to ${studentName || 'this student'}? They'll see their grade and feedback.`,
                () => post({ studentId }, 'Returned'),
                { title: 'Return exam', confirmText: 'Return' },
              )
            }
          >
            Return {studentName ? studentName.split(' ')[0] : 'student'}
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            dialog.showConfirm(
              'Return the graded exam to every student in this class who handed in?',
              () => post({ all: true, classId }, 'Returned all'),
              { title: 'Return all', confirmText: 'Return all' },
            )
          }
        >
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Return all
        </Button>
      </div>
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
    </>
  )
}
