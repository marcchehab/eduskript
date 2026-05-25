/**
 * Class Toolbar (id="class-toolbar")
 *
 * Fixed-top class/student administration bar. The canonical home for
 * everything a teacher does to manage classes, students, and broadcast
 * targets on their own pages. Sibling to the `AnnotationToolbar`
 * (id="annotation-toolbar") at the bottom, which now holds only drawing
 * tools and personal-view toggles.
 *
 * Visibility:
 *  - Own [domain] site only (session.user.pageSlug === teacher.pageSlug), OR
 *  - Org pages the viewer authored (the mount points enforce this).
 *  - AND paid teacher, AND has ≥ 1 class.
 *
 * Row 1 (always visible): audience dropdown (class | Public | Off), master
 * broadcast toggle, selected-student chip, exam state (exam pages),
 * "Submitted only" filter (exam + class), counts cluster, expand chevron.
 *
 * Expanded roster (slide-down): per-row broadcast button to target an
 * individual student, plus Reopen/Delete actions on author-owned rows.
 *
 * The unified table merges:
 *  - `useExamRoster` when a class is selected (exam pages only): provides
 *    "not-started" rows so the teacher sees the full roster.
 *  - `usePageSubmissions` always: provides answer counts, last-activity, and
 *    surfaces non-class respondents (e.g., anonymous survey shell users).
 */
'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  UserCircle,
  Radio,
  Globe,
  ClipboardList,
} from 'lucide-react'
import Link from 'next/link'
import { compareRoster } from '@/lib/exam-roster-order'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useSession } from 'next-auth/react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useLayout } from '@/contexts/layout-context'
import { useExamRoster, type ExamRosterStudent } from '@/hooks/use-exam-roster'
import {
  useExamAudit,
  summariseAttempts,
  formatDuration,
  type ExamAuditRow,
} from '@/hooks/use-exam-audit'
import { usePageSubmissions, type PageSubmissionRow } from '@/hooks/use-page-submissions'
import { useIsPaid } from '@/hooks/use-billing'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { cn } from '@/lib/utils'

interface PageClass {
  id: string
  name: string
  /** Total member count (students enrolled). Optional because the
   *  `unlockedClasses` prop carries only id+name from the route layer. */
  memberCount?: number
}

interface ClassToolbarProps {
  pageId: string
  /** `'exam'` enables state controls + Reopen; anything else hides them. */
  pageType: string
  /** Classes unlocked for this exam. Empty on non-exam pages. */
  unlockedClasses: PageClass[]
  /**
   * Owner pageSlug of the site this page belongs to. When set, the toolbar
   * self-gates on `session.user.pageSlug === requireOwnerSlug` so it only
   * appears on the viewer's own [domain] site. Omit/pass null on routes
   * where the mount has already validated visibility (e.g. org pages that
   * gate on `isPageAuthor`).
   */
  requireOwnerSlug?: string | null
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

export function ClassToolbar({
  pageId,
  pageType,
  unlockedClasses,
  requireOwnerSlug = null,
}: ClassToolbarProps) {
  const isExam = pageType === 'exam'
  const { data: session, status: sessionStatus } = useSession()
  const isPaid = useIsPaid()
  const { sidebarCollapsed } = useLayout()
  const isTeacherAccount = session?.user?.accountType === 'teacher'
  const viewerPageSlug = session?.user?.pageSlug ?? null
  // Own-site check: only relevant when caller pinned a specific owner slug
  // (e.g. on [domain] routes). Org-page mounts pass null and rely on their
  // own server-side isPageAuthor gate.
  const isOwnSite = requireOwnerSlug === null || viewerPageSlug === requireOwnerSlug

  // Teacher's classes — used for both the audience dropdown and the
  // has-≥1-class visibility gate. Fetched once per page; the same
  // /api/classes?pageId=… that `annotation-layer.tsx` consumes.
  const [teacherClasses, setTeacherClasses] = useState<PageClass[] | null>(null)
  useEffect(() => {
    if (!isTeacherAccount || !isPaid || !isOwnSite) return
    let cancelled = false
    fetch(`/api/classes?pageId=${encodeURIComponent(pageId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((data: { classes?: Array<{ id: string; name: string; memberCount?: number }> }) => {
        if (cancelled) return
        setTeacherClasses((data.classes ?? []).map((c) => ({ id: c.id, name: c.name, memberCount: c.memberCount })))
      })
      .catch(() => {
        if (!cancelled) setTeacherClasses([])
      })
    return () => { cancelled = true }
  }, [pageId, isTeacherAccount, isPaid, isOwnSite])

  const {
    selectedClass,
    setSelectedClass,
    selectedStudent,
    setSelectedStudent,
    broadcastToPage,
    setBroadcastToPage,
    broadcastingPaused,
    setBroadcastingPaused,
    submittedOnly,
    setSubmittedOnly,
  } = useTeacherClass()
  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string>>({})
  const [isUpdating, setIsUpdating] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [reopeningStudent, setReopeningStudent] = useState<string | null>(null)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  // Roster sort is fixed to most-recently-active first; sortable headers
  // were dropped when the table was compacted into a vertical list for the
  // sidebar mount. Re-introduce per-column controls if/when there's room.
  const sortKey: SortKey = 'activity'
  const sortDir: SortDir = 'desc'
  const dialog = useAlertDialog()

  const {
    students,
    examState,
    refresh: refreshRoster,
  } = useExamRoster({
    pageId,
    // Fire for any selected class, not just on exam pages — the underlying
    // endpoint returns class membership + per-user submission state, which
    // is exactly what the sidebar roster needs regardless of pageType.
    classId: selectedClass?.id ?? null,
  })

  const {
    isAuthor,
    isResolving,
    submissions,
    yourAnonymousUserId,
    refresh: refreshSubmissions,
  } = usePageSubmissions({ pageId })

  // Exam audit log drives the "took Nm" caption + per-student timeline
  // tooltip. Only meaningful on exam pages, so dormant otherwise.
  const { events: auditEvents } = useExamAudit({
    pageId,
    classId: selectedClass?.id ?? null,
    enabled: isExam,
  })

  // Ticking clock so the in-progress "Nm so far" counter advances without
  // refetching the audit log. 30s is granular enough to feel live and
  // cheap compared with the 10s roster poll already in flight.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!isExam) return
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [isExam])

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

  // Build the row set. Two modes:
  //   • A class is selected → rows are exactly that class's members. Anyone
  //     who submitted but isn't enrolled is intentionally excluded; the
  //     roster is "who is in this class", not "who answered this page".
  //     Submission data (answerCount / lastActivityAt / isAnonymous) is
  //     merged INTO matching roster rows.
  //   • No class selected → fall back to listing everyone who has
  //     submission data on the page (e.g. anonymous survey shell users).
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
      } else if (!selectedClass) {
        // Only surface submission-only users when no class is selected —
        // otherwise they'd dilute the "members of this class" view.
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

    // Honor the "Submitted only" checkbox on exam pages so the filter the
    // teacher just toggled visibly affects the roster sitting right next to
    // it. Without this the checkbox only filtered the gutter-arrow navigator
    // and looked broken from the sidebar's perspective.
    let out = Array.from(byId.values())
    if (isExam && submittedOnly) {
      out = out.filter((r) => r.examStatus === 'submitted')
    }
    // Exam roster uses the canonical order shared with the StudentNavigator
    // arrows (so the arrows step through this exact list). Non-exam pages keep
    // the activity sort.
    if (isExam) {
      out.sort((a, b) => compareRoster({ status: a.examStatus, name: a.displayName }, { status: b.examStatus, name: b.displayName }))
    } else {
      out.sort(makeComparator(sortKey, sortDir))
    }
    return out
  }, [students, submissions, resolvedEmails, sortKey, sortDir, selectedClass, isExam, submittedOnly])

  // Display name of the viewer's own anonymous row (when their browser has a
  // matching survey sessionId in localStorage). Lets the toolbar show a
  // "you are X" chip up top so the teacher can spot their own test row.
  const yourAnonymousDisplayName = useMemo(() => {
    if (!yourAnonymousUserId) return null
    return submissions.find(s => s.userId === yourAnonymousUserId)?.displayName ?? null
  }, [submissions, yourAnonymousUserId])

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

  // Self-gating: render nothing until we can confirm the viewer is a paid
  // teacher on their own site with ≥ 1 class. Lets the toolbar mount
  // unconditionally on ISR-cached public pages without flashing.
  //
  // The `isAuthor` flag from `usePageSubmissions` is kept further down as
  // defense-in-depth for destructive actions (delete/reopen), but it is no
  // longer the top-level visibility gate — own-site (or org-mount-time
  // isPageAuthor) is.
  if (sessionStatus === 'loading' || teacherClasses === null) return null
  if (!isTeacherAccount || !isPaid) return null
  if (!isOwnSite) return null
  if (teacherClasses.length === 0) return null
  if (isResolving) return null

  // Empty-shell case: exam page with no unlocked classes AND no submissions.
  if (isExam && unlockedClasses.length === 0 && submissions.length === 0) {
    return (
      <FixedToolbarFrame>
        <div className="bg-muted/50 border border-border rounded-lg p-3">
          <p className="text-sm text-muted-foreground text-center">
            No classes have been unlocked for this exam yet.
          </p>
        </div>
      </FixedToolbarFrame>
    )
  }

  // Collapsed sidebar: show only the broadcast toggle. The selected
  // audience (class / student / public) carries over from teacher-class
  // context, so the toggle just flips on/off against whatever was last
  // picked while the sidebar was expanded. Disabled when nothing has
  // been selected yet — same as the expanded toggle.
  if (sidebarCollapsed) {
    return (
      <FixedToolbarFrame>
        <BroadcastToggle
          active={!broadcastingPaused}
          disabled={!selectedClass && !broadcastToPage && !selectedStudent}
          onToggle={() => setBroadcastingPaused(!broadcastingPaused)}
        />
      </FixedToolbarFrame>
    )
  }

  const stateConfig = getStateConfig(examState)

  return (
    <FixedToolbarFrame>
      <div className="overflow-hidden">
      {/* Roster expansion slides UP (rendered ABOVE row 1) because the
          toolbar sits at the bottom of the sidebar — unfolding downward
          would push the row 1 off-screen, while unfolding upward grows
          into the empty sidebar space above. */}
      {isExpanded && (
        <div className="border-b border-border mb-2 pb-2">
          <div className="max-h-96 overflow-y-auto -mx-1">
            {rows.length === 0 ? (
              <div className="px-1 py-3 text-center text-xs text-muted-foreground">
                {selectedClass
                  ? (isExam && submittedOnly
                    ? 'No students have submitted yet.'
                    : 'No students in this class yet.')
                  : 'No submissions on this page yet.'}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((row) => {
                  const isViewingThis = selectedStudent?.id === row.userId
                  // Secondary line shows the DB email (typically a pseudonym
                  // for OAuth students) when it differs from displayName.
                  // displayName is already the locally-mapped real email when
                  // a mapping exists, so showing row.email below gives the
                  // teacher both the real identity and the pseudonym to
                  // cross-reference — same affordance the old two-column
                  // table provided before the sidebar consolidation.
                  const secondaryEmail =
                    row.email && row.email !== row.displayName ? row.email : null
                  // Per-attempt duration data — only used on exam pages.
                  const auditRows = isExam ? auditEvents[row.userId] : undefined
                  const summary = isExam ? summariseAttempts(auditRows, nowMs) : null
                  const captionParts: string[] = []
                  if (row.answerCount > 0) captionParts.push(`${row.answerCount} ans`)
                  if (isExam) {
                    const label = getStatusLabel(row.examStatus)
                    if (label && label !== '—') captionParts.push(label.toLowerCase())
                  }
                  // Time caption: prefer audit-derived duration on exam
                  // pages ("took 43m" or "12m so far"); fall back to the
                  // last-activity relative time for legacy submissions
                  // (no audit history) and for non-exam pages.
                  const examTimeLabel = summary
                    ? summary.inProgressSinceMs !== null
                      ? `${formatDuration(summary.inProgressSinceMs)} so far`
                      : summary.hasSubmitted && summary.completedMs > 0
                        ? `took ${formatDuration(summary.completedMs)}`
                        : null
                    : null
                  if (examTimeLabel) {
                    captionParts.push(examTimeLabel)
                  } else {
                    const activity = formatRelative(row.lastActivityAt)
                    if (activity && activity !== '—') captionParts.push(activity)
                  }
                  // Multi-line tooltip on the student name: timeline of
                  // exam events. Falls back to row.email when there's no
                  // audit history, preserving the prior pseudonym hint.
                  const timelineTooltip = auditRows && auditRows.length > 0
                    ? formatTimelineTooltip(auditRows, summary)
                    : row.email ?? undefined
                  return (
                    <li
                      key={row.userId}
                      className={cn(
                        'rounded-md px-1.5 py-1',
                        isViewingThis && 'bg-amber-50 dark:bg-amber-950/30'
                      )}
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedStudent({
                              id: row.userId,
                              displayName: row.displayName,
                              pseudonym: row.studentPseudonym ?? undefined,
                              revealedEmail: row.email,
                            })
                          }
                          className={cn(
                            'text-sm truncate flex-1 min-w-0 text-left hover:underline',
                            isViewingThis && 'font-medium',
                          )}
                          title={timelineTooltip ?? 'View this student in the exam'}
                        >
                          {row.displayName}
                        </button>
                        {row.isAnonymous && (
                          <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                            anon
                          </span>
                        )}
                        {row.userId === yourAnonymousUserId && (
                          <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-primary/15 text-primary flex-shrink-0">
                            you
                          </span>
                        )}
                        <Button
                          variant={isViewingThis ? 'default' : 'ghost'}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isViewingThis) {
                              setSelectedStudent(null)
                            } else {
                              setSelectedStudent({
                                id: row.userId,
                                displayName: row.displayName,
                                pseudonym: row.studentPseudonym ?? undefined,
                                revealedEmail: row.email,
                              })
                            }
                          }}
                          className="h-6 w-6 p-0 flex-shrink-0"
                          title={
                            isViewingThis
                              ? 'Stop broadcasting to this student (revert to class target)'
                              : 'Broadcast to this student only'
                          }
                        >
                          <Radio className={cn('w-3 h-3', isViewingThis && 'animate-pulse')} />
                        </Button>
                        {isExam && row.examStatus === 'submitted' && row.inRoster && selectedClass && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              reopenForStudent(row.userId)
                            }}
                            disabled={reopeningStudent === row.userId}
                            className="h-6 w-6 p-0 flex-shrink-0"
                            title="Allow student to retake exam"
                          >
                            {reopeningStudent === row.userId ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
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
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive flex-shrink-0"
                          title="Delete this user's answers on this page"
                        >
                          {deletingUser === row.userId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      {secondaryEmail && (
                        <div
                          className="text-[10px] text-muted-foreground pl-[18px] truncate"
                          title={secondaryEmail}
                        >
                          {secondaryEmail}
                        </div>
                      )}
                      {captionParts.length > 0 && (
                        <div className="text-[10px] text-muted-foreground pl-[18px] truncate">
                          {captionParts.join(' · ')}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="">
        <div className="flex items-center gap-2 min-w-0">
          {/* 1. Master broadcast toggle (icon only, red when active). */}
          <BroadcastToggle
            active={!broadcastingPaused}
            disabled={!selectedClass && !broadcastToPage && !selectedStudent}
            onToggle={() => setBroadcastingPaused(!broadcastingPaused)}
          />

          {/* 2. Audience dropdown (auto-width, content-sized). On exam pages
              the unlocked-class restriction still applies, but we render the
              same compact dropdown to keep the row uniform. */}
          {!isExam && teacherClasses && (
            <AudienceDropdown
              classes={teacherClasses}
              selectedClass={selectedClass}
              broadcastToPage={broadcastToPage}
              paused={broadcastingPaused}
              onPickClass={(cls) => setSelectedClass(cls)}
              onPickPublic={() => setBroadcastToPage(true)}
            />
          )}
          {isExam && unlockedClasses.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 min-w-0">
                  <span className="truncate">{selectedClass?.name || 'Select class'}</span>
                  <ChevronUp className="w-4 h-4 flex-shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
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
          )}

          {/* 3. Class member count + expand chevron. Reflects the class size
              (not just answer-submitting respondents). Hidden when no class
              is the current target. */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="ml-auto flex items-center gap-1 text-sm text-muted-foreground hover:bg-muted/50 rounded-md px-2 py-1 transition-colors flex-shrink-0"
            title={isExpanded ? 'Hide roster' : 'Show roster'}
          >
            <Users className="w-4 h-4" />
            <span className="tabular-nums">
              {(selectedClass && teacherClasses?.find(c => c.id === selectedClass.id)?.memberCount) ?? '—'}
            </span>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Secondary rows: selected-student label, "you are X" anon chip, and
            exam-only controls (state + submitted-only). Each only renders
            when its condition holds, so the chrome stays minimal in the
            common case. */}
        {selectedStudent && (
          <div className="mt-1 text-xs text-muted-foreground truncate" title="Click this student's row in the roster to revert to class target">
            → {selectedStudent.displayName}
            {selectedStudent.revealedEmail && (
              <span className="opacity-70"> ({selectedStudent.revealedEmail})</span>
            )}
          </div>
        )}

        {yourAnonymousDisplayName && (
          <div
            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
            title="Your own anonymous survey response on this page"
          >
            <UserCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              You are <strong className="text-foreground">{yourAnonymousDisplayName}</strong>
            </span>
          </div>
        )}

        {isExam && selectedClass && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  className={cn(
                    'gap-2',
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
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
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
            <Button variant="outline" size="sm" asChild className="gap-1.5">
              <Link href={`/dashboard/exams/${pageId}/grading?classId=${selectedClass.id}`}>
                <ClipboardList className="w-4 h-4" />
                Grade
              </Link>
            </Button>
          </div>
        )}
      </div>

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
    </FixedToolbarFrame>
  )
}

/**
 * Renders the class toolbar inside the sidebar via portal.
 *
 * The slot (`#class-toolbar-slot`) lives in the expanded sidebar header in
 * `src/components/public/layout.tsx`. When the sidebar is collapsed or the
 * route doesn't use `PublicSiteLayout`, the slot is absent and we render
 * nothing. We poll for the slot once on mount (it commits in the same React
 * pass as this component) and re-check on layout-affecting events
 * (window.resize, ResizeObserver on body) so collapse/expand toggles the
 * toolbar's visibility without remounting it.
 */
function FixedToolbarFrame({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const find = () => setSlot(document.getElementById('class-toolbar-slot'))
    find()
    // The slot appears/disappears when the sidebar toggles between expanded
    // and collapsed. Observing body catches that without a hardcoded class
    // dependency.
    const observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  if (!slot) return null
  return createPortal(
    <div id="class-toolbar">
      {children}
    </div>,
    slot
  )
}

/**
 * Audience picker shown on non-exam pages. The teacher's full class list
 * plus "Public" (page-author broadcast). There's no explicit "off" entry —
 * deactivating broadcast is the broadcast toggle's job.
 *
 * When the broadcast toggle is paused, this dropdown is rendered with
 * reduced opacity to signal that the selection currently has no effect.
 */
function AudienceDropdown({
  classes,
  selectedClass,
  broadcastToPage,
  paused,
  onPickClass,
  onPickPublic,
}: {
  classes: PageClass[]
  selectedClass: { id: string; name: string } | null
  broadcastToPage: boolean
  paused: boolean
  onPickClass: (cls: { id: string; name: string }) => void
  onPickPublic: () => void
}) {
  const label = broadcastToPage
    ? 'Public'
    : selectedClass?.name ?? 'Pick audience'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-1.5 min-w-0', paused && 'opacity-50')}
        >
          <span className="flex items-center gap-1.5 truncate">
            {broadcastToPage && <Globe className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronUp className="w-4 h-4 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-[200px]">
        <DropdownMenuItem onClick={onPickPublic} className="gap-2">
          <Globe className="w-4 h-4" />
          <div>
            <div className="font-medium">Public</div>
            <div className="text-xs text-muted-foreground">Visible to everyone on this page</div>
          </div>
        </DropdownMenuItem>
        {classes.length > 0 && <div className="h-px bg-border my-1" />}
        {classes.map((cls) => (
          <DropdownMenuItem
            key={cls.id}
            onClick={() => onPickClass(cls)}
            className={cn('gap-2', !broadcastToPage && selectedClass?.id === cls.id && 'bg-accent font-medium')}
          >
            <Users className="w-4 h-4" />
            <span className="truncate">{cls.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Master broadcast toggle. ON = annotations route to the selected audience
 * (class / student / public). OFF = personal annotations regardless of any
 * saved target. Disabled when nothing is selected to broadcast to.
 */
function BroadcastToggle({
  active,
  disabled,
  onToggle,
}: {
  active: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'h-8 w-8 p-0 flex-shrink-0',
        active && 'bg-red-500 text-white border-red-500 hover:bg-red-600 hover:text-white hover:border-red-600'
      )}
      title={
        disabled
          ? 'Pick an audience first'
          : active
            ? 'Broadcasting to selected audience. Click to pause.'
            : 'Personal annotations only. Click to broadcast to selected audience.'
      }
    >
      <Radio className={cn('w-4 h-4', active && 'animate-pulse')} />
    </Button>
  )
}

/**
 * Multi-line title attribute showing the student's exam event timeline
 * (Started 13:02 · Reopened 13:45 · Submitted 14:10), with a trailing
 * total/in-progress duration when known. Plain text — relies on the
 * browser's native title rendering, so no Popover overhead.
 */
function formatTimelineTooltip(
  rows: ExamAuditRow[],
  summary: ReturnType<typeof summariseAttempts> | null,
): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  const labels: Record<ExamAuditRow['event'], string> = {
    started: 'Started',
    submitted: 'Submitted',
    reopened: 'Reopened',
  }
  const lines = rows.map(
    (r) => `${labels[r.event]} ${fmt.format(new Date(r.occurredAt))}`,
  )
  if (summary) {
    if (summary.inProgressSinceMs !== null) {
      lines.push(`In progress · ${formatDuration(summary.inProgressSinceMs)} so far`)
    } else if (summary.hasSubmitted && summary.completedMs > 0) {
      lines.push(`Total · ${formatDuration(summary.completedMs)}`)
    }
  }
  return lines.join('\n')
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
