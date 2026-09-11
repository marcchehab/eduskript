/**
 * Exam Complete Display Page
 *
 * This page displays after the exam session has been ended.
 * The actual session cleanup happens in /api/exams/end-session.
 *
 * Note: The quitURL in SEB config should point to /api/exams/end-session,
 * which clears the session and redirects here.
 */

export default function ExamCompletePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-8 max-w-md">
        <h1 className="text-2xl font-bold mb-4">Exam Complete</h1>
        <p className="text-muted-foreground mb-6">
          You can now close Safe Exam Browser.
        </p>
        <p className="text-sm text-muted-foreground">
          SEB should close automatically. If it doesn&apos;t, you may need to wait
          a moment for the quit confirmation dialog to appear.
        </p>
      </div>
    </div>
  )
}
