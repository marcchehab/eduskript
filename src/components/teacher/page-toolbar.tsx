/**
 * Teacher Page Toolbar
 *
 * Sticky-top control bar shown to teachers viewing their own page. Replaces
 * the older `TeacherExamToolbar` with a superset that also handles non-exam
 * pages (surveys, embedded quizzes, python/SQL exercises).
 *
 * Modes:
 *  - **Exam page + unlocked classes**: full exam controls (class selector,
 *    Closed/Lobby/Open state, Reopen per student) on top of the submissions
 *    list. Identical to the old toolbar's behaviour.
 *  - **Any page with submissions**: lists everyone (incl. anonymous survey
 *    respondents) who has userData on the page. Per-row Delete wipes their
 *    answers; annotations / sticky notes are preserved.
 *
 * The unified table merges:
 *  - `useExamRoster` when a class is selected (exam pages only): provides
 *    "not-started" rows so the teacher sees the full roster.
 *  - `usePageSubmissions` always: provides answer counts, last-activity, and
 *    surfaces non-class respondents (e.g., anonymous survey shell users).
 *
 * Columns are sortable client-side; sort state is local to the component.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  User,
  Circle,
  RotateCcw,
  DoorOpen,
  Lock,
  Unlock,
  Eye,
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useExamRoster, type ExamRosterStudent } from '@/hooks/use-exam-roster'
import { usePageSubmissions, type PageSubmissionRow } from '@/hooks/use-page-submissions'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { cn } from '@/lib/utils'

interface PageClass {
  id: string
  name: string
}

interface TeacherPageToolbarProps {
  pageId: string
  /** `'exam'` enables state controls + Reopen; anything else hides them. */
  pageType: string
  /** Classes unlocked for this exam. Empty on non-exam pages. */
  unlockedClasses: PageClass[]
}

type SortKey = 'name' | 'email' | 'status' | 'answers' | 'activity'
type SortDir = 'asc' | 'desc'

interface MergedRow {
  userId: string
  displayName: string
  email: string | null
  studentPseudonym: string | null
  isAnonymous: boolean
  /** True when the row comes from the class roster (membership). */
  inRoster: boolean
  /** True when the user has any userData on this page. */
  hasSubmissionData: boolean
  examStatus: 'not_started' | 'taking' | 'submitted' | null
  startedAt?: string
  submittedAt?: string | null
  answerCount: number
  /** ISO timestamp, or null if unknown. */
  lastActivityAt: string | null
}

export function TeacherPageToolbar({
  pageId,
  pageType,
  unlockedClasses,
}: TeacherPageToolbarProps) {
  const isExam = pageType === 'exam'
  const {
    selectedClass,
    setSelectedClass,
    selectedStudent,
    setSelectedStudent,
    submittedOnly,
    setSubmittedOnly,
  } = useTeacherClass()
  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string>>({})
  const [isUpdating, setIsUpdating] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [reopeningStudent, setReopeningStudent] = useState<string | null>(null)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('activity')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const dialog = useAlertDialog()

  const {
    students,
    counts: rosterCounts,
    examState,
    refresh: refreshRoster,
  } = useExamRoster({
    pageId,
    classId: isExam ? selectedClass?.id ?? null : null,
  })

  const {
    isAuthor,
    isResolving,
    submissions,
    refresh: refreshSubmissions,
  } = usePageSubmissions({ pageId })

  // Load resolved email mappings when class changes (exam case only).
  useEffect(() => {
    if (!selectedClass) { setResolvedEmails({}); return }
    getReverseMappingsForClass(selectedClass.id)
      .then(setResolvedEmails)
      .catch(() => setResolvedEmails({}))
  }, [selectedClass])

  // Auto-select first unlocked class on exam pages.
  useEffect(() => {
    if (!isExam) return
    if (!selectedClass && unlockedClasses.length > 0) {
      setSelectedClass({ id: unlockedClasses[0].id, name: unlockedClasses[0].name })
    }
  }, [isExam, selectedClass, unlockedClasses, setSelectedClass])

  const refreshAll = () => {
    refreshRoster()
    refreshSubmissions()
  }

  // Build the merged row set: union of class roster (when present) and
  // anyone who has submission data on the page. Keyed by userId; roster
  // fields take precedence for identity (they have resolved emails), and
  // submission fields fill in counts/last-activity.
  const rows: MergedRow[] = useMemo(() => {
    const byId = new Map<string, MergedRow>()

    for (const student of students) {
      byId.set(student.id, {
        userId: student.id,
        displayName: getRosterDisplayName(student, resolvedEmails),
        email: student.email,
        studentPseudonym: student.studentPseudonym,
        isAnonymous: false,
        inRoster: true,
        hasSubmissionData: false,
        examStatus: student.status,
        startedAt: student.startedAt,
        submittedAt: student.submittedAt ?? null,
        answerCount: 0,
        lastActivityAt: student.submittedAt ?? student.startedAt ?? null,
      })
    }

    for (const sub of submissions) {
      const existing = byId.get(sub.userId)
      if (existing) {
        existing.hasSubmissionData = true
        existing.answerCount = sub.answerCount
        // Submission lastActivityAt is more precise than roster start/submit
        // timestamps when both exist — it tracks the latest userData write.
        existing.lastActivityAt = sub.lastActivityAt
        // Anonymous flag stays whatever the submission side reports for
        // shell users; for class-resolved members it stays false.
        existing.isAnonymous = existing.isAnonymous || sub.isAnonymous
      } else {
        byId.set(sub.userId, {
          userId: sub.userId,
          displayName: sub.displayName,
          email: sub.email,
          studentPseudonym: sub.studentPseudonym,
          isAnonymous: sub.isAnonymous,
          inRoster: false,
          hasSubmissionData: true,
          examStatus: sub.examStatus,
          startedAt: undefined,
          submittedAt: sub.examSubmittedAt,
          answerCount: sub.answerCount,
          lastActivityAt: sub.lastActivityAt,
        })
      }
    }

    const out = Array.from(byId.values())
    out.sort(makeComparator(sortKey, sortDir))
    return out
  }, [students, submissions, resolvedEmails, sortKey, sortDir])

  const counts = useMemo(() => {
    const total = rows.length
    const submitted = rows.filter(r => r.examStatus === 'submitted').length
    const taking = rows.filter(r => r.examStatus === 'taking').length
    const respondents = rows.filter(r => r.answerCount > 0).length
    return { total, submitted, taking, respondents }
  }, [rows])

  const setExamStateTo = async (newState: 'closed' | 'lobby' | 'open') => {
    if (!selectedClass) return
    setIsUpdating(true)
    try {
      const response = await fetch(`/api/exams/${pageId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: selectedClass.id, state: newState }),
      })
      if (response.ok) refreshRoster()
    } catch (error) {
      console.error('Error updating exam state:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const reopenForStudent = async (studentId: string) => {
    if (!selectedClass) return
    setReopeningStudent(studentId)
    try {
      const response = await fetch(`/api/exams/${pageId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, classId: selectedClass.id, action: 'reopen' }),
      })
      if (response.ok) {
        refreshAll()
      } else {
        const data = await response.json().catch(() => ({}))
        console.error('Error reopening exam:', data?.error)
      }
    } catch (error) {
      console.error('Error reopening exam for student:', error)
    } finally {
      setReopeningStudent(null)
    }
  }

  const deleteSubmissions = async (row: MergedRow) => {
    setDeletingUser(row.userId)
    try {
      const response = await fetch(
        `/api/pages/${pageId}/submissions/${row.userId}`,
        { method: 'DELETE' }
      )
      if (response.ok) {
        // Drop selection if we just nuked the viewed student.
        if (selectedStudent?.id === row.userId) setSelectedStudent(null)
        refreshAll()
      } else {
        const data = await response.json().catch(() => ({}))
        dialog.showError(data?.error ?? 'Failed to delete answers')
      }
    } catch (error) {
      console.error('Error deleting submissions:', error)
      dialog.showError('Failed to delete answers')
    } finally {
      setDeletingUser(null)
    }
  }

  const confirmDelete = (row: MergedRow) => {
    dialog.showConfirm(
      `Delete all answers by ${row.displayName} on this page?\n\nAnnotations and sticky notes are kept. This cannot be undone.`,
      () => { void deleteSubmissions(row) },
      { title: 'Delete answers', destructive: true, confirmText: 'Delete' }
    )
  }

  const viewStudent = (row: MergedRow) => {
    if (!isExam) return
    if (selectedStudent?.id === row.userId) {
      setSelectedStudent(null)
      return
    }
    setSelectedStudent({
      id: row.userId,
      displayName: row.displayName,
      pseudonym: row.studentPseudonym ?? undefined,
      revealedEmail: row.email,
    })
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'activity' || key === 'answers' ? 'desc' : 'asc')
    }
  }

  // Self-gating: render nothing while authorship is being resolved or for
  // viewers who aren't authors. This is what lets the toolbar mount
  // unconditionally on ISR-cached public pages.
  if (isResolving || !isAuthor) return null

  // Empty-shell case: exam page with no unlocked classes AND no submissions.
  if (isExam && unlockedClasses.length === 0 && submissions.length === 0) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-3 mb-4">
        <p className="text-sm text-muted-foreground text-center">
          No classes have been unlocked for this exam yet.
        </p>
      </div>
    )
  }

  const stateConfig = getStateConfig(examState)

  return (
    <div className="sticky top-0 z-30 bg-card border border-border rounded-lg mb-4 shadow-sm overflow-hidden">
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Class selector — only when there are unlocked classes (exam pages) */}
          {isExam && unlockedClasses.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Class:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      {selectedClass?.name || 'Select class'}
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {unlockedClasses.map((cls) => (
                      <DropdownMenuItem
                        key={cls.id}
                        onClick={() => setSelectedClass({ id: cls.id, name: cls.name })}
                      >
                        {cls.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="hidden sm:block w-px h-6 bg-border" />
            </>
          )}

          {/* Exam state control */}
          {isExam && selectedClass && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  className={cn(
                    'gap-2 min-w-[120px]',
                    examState === 'closed' && 'border-red-500/50',
                    examState === 'lobby' && 'border-yellow-500/50',
                    examState === 'open' && 'border-green-500/50'
                  )}
                >
                  {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <div className={cn('w-2 h-2 rounded-full', stateConfig.color)} />
                      <span>{stateConfig.label}</span>
                    </>
                  )}
                  <ChevronDown className="w-4 h-4 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => setExamStateTo('closed')}
                  disabled={examState === 'closed'}
                  className="gap-2"
                >
                  <Lock className="w-4 h-4 text-red-500" />
                  <div>
                    <div className="font-medium">Closed</div>
                    <div className="text-xs text-muted-foreground">Students cannot enter</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setExamStateTo('lobby')}
                  disabled={examState === 'lobby'}
                  className="gap-2"
                >
                  <DoorOpen className="w-4 h-4 text-yellow-500" />
                  <div>
                    <div className="font-medium">Lobby</div>
                    <div className="text-xs text-muted-foreground">Students wait for you to open</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setExamStateTo('open')}
                  disabled={examState === 'open'}
                  className="gap-2"
                >
                  <Unlock className="w-4 h-4 text-green-500" />
                  <div>
                    <div className="font-medium">Open</div>
                    <div className="text-xs text-muted-foreground">Students can take the exam</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="flex-1" />

          {selectedStudent && (
            <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-amber-100/80 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100">
              <Eye className="w-3.5 h-3.5" />
              <span className="truncate max-w-[180px]">Viewing {selectedStudent.displayName}</span>
              <button
                onClick={() => setSelectedStudent(null)}
                className="ml-1 p-0.5 rounded hover:bg-amber-200/60 dark:hover:bg-amber-800/60"
                title="Back to my own view"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {isExam && selectedClass && (
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
              title="Cycle only through students who have handed in"
            >
              <input
                type="checkbox"
                checked={submittedOnly}
                onChange={(e) => setSubmittedOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>Submitted only</span>
            </label>
          )}

          {/* Counts summary (clickable). On exam pages: roster total + taking +
              submitted. On non-exam: respondent count only. */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-4 text-sm hover:bg-muted/50 rounded-md px-2 py-1 -mr-2 transition-colors"
          >
            <div className="flex items-center gap-1 text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>{isExam ? (rosterCounts?.total ?? counts.total) : counts.respondents}</span>
            </div>
            {isExam && (
              <>
                <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
                  <Clock className="w-4 h-4" />
                  <span>{rosterCounts?.taking ?? counts.taking}</span>
                </div>
                <div className="flex items-center gap-1 text-green-600 dark:text-green-500">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{rosterCounts?.submitted ?? counts.submitted}</span>
                </div>
              </>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border">
          <div className="max-h-80 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {isExam && selectedClass
                  ? 'No students in this class yet.'
                  : 'No submissions on this page yet.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <SortHeader label="Student" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="Email" k="email" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    {isExam && (
                      <SortHeader label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    )}
                    <SortHeader label="Answers" k="answers" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <SortHeader label="Last activity" k="activity" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const isViewingThis = selectedStudent?.id === row.userId
                    return (
                      <tr
                        key={row.userId}
                        onClick={() => viewStudent(row)}
                        className={cn(
                          isExam && 'cursor-pointer',
                          'hover:bg-muted/30',
                          isViewingThis && 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50'
                        )}
                        title={isExam ? (isViewingThis ? 'Click to stop viewing' : "Click to view this student's work") : undefined}
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate max-w-[200px]">{row.displayName}</span>
                            {row.isAnonymous && (
                              <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                anon
                              </span>
                            )}
                            {isViewingThis && <Eye className="w-3 h-3 text-amber-600 flex-shrink-0" />}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          <span className="truncate max-w-[200px] block">{row.email || '-'}</span>
                        </td>
                        {isExam && (
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              {getStatusIcon(row.examStatus)}
                              <span className={statusColorClass(row.examStatus)}>
                                {getStatusLabel(row.examStatus)}
                              </span>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums">{row.answerCount}</td>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          {formatRelative(row.lastActivityAt)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isExam && row.examStatus === 'submitted' && row.inRoster && selectedClass && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  reopenForStudent(row.userId)
                                }}
                                disabled={reopeningStudent === row.userId}
                                className="h-7 px-2 text-xs gap-1"
                                title="Allow student to retake exam"
                              >
                                {reopeningStudent === row.userId ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3" />
                                )}
                                Reopen
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                confirmDelete(row)
                              }}
                              disabled={deletingUser === row.userId || (!row.hasSubmissionData && !row.submittedAt)}
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              title="Delete this user's answers on this page"
                            >
                              {deletingUser === row.userId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
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
    </div>
  )
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = 'left',
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onClick: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey === k
  return (
    <th className={cn('px-4 py-2 font-medium text-muted-foreground', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        onClick={() => onClick(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        <span>{label}</span>
        {active && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  )
}

function getRosterDisplayName(
  student: ExamRosterStudent,
  resolvedEmails: Record<string, string>
): string {
  // DB is the source of truth: only synthesise nothing here. If User.name is
  // null in the database, render an em dash, not a derived nickname.
  const resolved = student.studentPseudonym ? resolvedEmails[student.studentPseudonym] : null
  if (resolved) return resolved
  if (student.name) return student.name
  return '—'
}

function getStateConfig(examState: 'closed' | 'lobby' | 'open' | null) {
  switch (examState) {
    case 'open':
      return { color: 'bg-green-500', label: 'Open' }
    case 'lobby':
      return { color: 'bg-yellow-500', label: 'Lobby' }
    default:
      return { color: 'bg-red-500', label: 'Closed' }
  }
}

function getStatusIcon(status: MergedRow['examStatus']) {
  switch (status) {
    case 'taking':
      return <Clock className="w-4 h-4 text-yellow-500" />
    case 'submitted':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />
    case 'not_started':
      return <Circle className="w-4 h-4 text-muted-foreground" />
    default:
      return <Circle className="w-4 h-4 text-muted-foreground/50" />
  }
}

function getStatusLabel(status: MergedRow['examStatus']) {
  switch (status) {
    case 'taking':
      return 'Taking exam'
    case 'submitted':
      return 'Submitted'
    case 'not_started':
      return 'Not started'
    default:
      return '—'
  }
}

function statusColorClass(status: MergedRow['examStatus']) {
  switch (status) {
    case 'taking':
      return 'text-yellow-600 dark:text-yellow-500'
    case 'submitted':
      return 'text-green-600 dark:text-green-500'
    default:
      return 'text-muted-foreground'
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return date.toLocaleDateString()
}

function makeComparator(key: SortKey, dir: SortDir) {
  const mul = dir === 'asc' ? 1 : -1
  return (a: MergedRow, b: MergedRow): number => {
    switch (key) {
      case 'name':
        return mul * a.displayName.localeCompare(b.displayName)
      case 'email':
        return mul * ((a.email ?? '').localeCompare(b.email ?? ''))
      case 'status':
        return mul * (statusOrder(a.examStatus) - statusOrder(b.examStatus))
      case 'answers':
        return mul * (a.answerCount - b.answerCount)
      case 'activity': {
        const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0
        const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0
        return mul * (at - bt)
      }
    }
  }
}

function statusOrder(status: MergedRow['examStatus']): number {
  switch (status) {
    case 'taking':
      return 0
    case 'submitted':
      return 1
    case 'not_started':
      return 2
    default:
      return 3
  }
}
