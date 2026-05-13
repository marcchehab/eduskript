/**
 * Teacher Exam Toolbar Component
 *
 * A collapsible control bar for teachers to manage exam state per class.
 * Shows at the top of the page when viewing their own exam as a teacher.
 *
 * Features:
 * - Expandable drawer with detailed student list
 * - Class selector (from unlocked classes)
 * - Three-state control: Closed → Lobby → Open (any transition allowed)
 * - Live student counts and individual status
 * - Reopen action for submitted students
 */

'use client'

import { useState, useEffect } from 'react'
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
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useExamRoster, type ExamRosterStudent } from '@/hooks/use-exam-roster'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { cn } from '@/lib/utils'

interface ExamClass {
  id: string
  name: string
}

interface TeacherExamToolbarProps {
  pageId: string
  unlockedClasses: ExamClass[]
}

export function TeacherExamToolbar({
  pageId,
  unlockedClasses
}: TeacherExamToolbarProps) {
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

  const {
    students,
    counts: studentCounts,
    examState,
    refresh: refreshRoster,
  } = useExamRoster({
    pageId,
    classId: selectedClass?.id ?? null,
  })

  // Load resolved email mappings when class changes
  useEffect(() => {
    if (!selectedClass) { setResolvedEmails({}); return }
    getReverseMappingsForClass(selectedClass.id)
      .then(setResolvedEmails)
      .catch(() => setResolvedEmails({}))
  }, [selectedClass])

  // Auto-select first class if none selected and classes available
  useEffect(() => {
    if (!selectedClass && unlockedClasses.length > 0) {
      setSelectedClass({
        id: unlockedClasses[0].id,
        name: unlockedClasses[0].name
      })
    }
  }, [selectedClass, unlockedClasses, setSelectedClass])

  // Get display name for student (prefer resolved email, then name, then pseudonym).
  // Hoisted so the click handler below can capture it.
  const getStudentDisplayName = (student: ExamRosterStudent) => {
    const resolved = student.studentPseudonym ? resolvedEmails[student.studentPseudonym] : null
    if (resolved) return resolved
    if (student.name) return student.name
    if (student.studentPseudonym) return `Student ${student.studentPseudonym.slice(0, 8)}`
    return 'Unknown student'
  }

  // Set exam state directly
  const setExamStateTo = async (newState: 'closed' | 'lobby' | 'open') => {
    if (!selectedClass) return

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/exams/${pageId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: selectedClass.id,
          state: newState
        })
      })

      if (response.ok) {
        // Refresh roster after state change (covers state cell + any state-derived counts)
        refreshRoster()
      }
    } catch (error) {
      console.error('Error updating exam state:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  // Reopen exam for a specific student
  const reopenForStudent = async (studentId: string) => {
    if (!selectedClass) return

    setReopeningStudent(studentId)
    try {
      const response = await fetch(`/api/exams/${pageId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          classId: selectedClass.id,
          action: 'reopen'
        })
      })

      if (response.ok) {
        refreshRoster()
      } else {
        const data = await response.json()
        console.error('Error reopening exam:', data.error)
      }
    } catch (error) {
      console.error('Error reopening exam for student:', error)
    } finally {
      setReopeningStudent(null)
    }
  }

  // Toggle "view this student's snapshot" mode by clicking a roster row.
  // Clicking the already-selected student exits view mode (back to teacher's own view).
  const viewStudent = (student: ExamRosterStudent) => {
    if (selectedStudent?.id === student.id) {
      setSelectedStudent(null)
      return
    }
    setSelectedStudent({
      id: student.id,
      displayName: getStudentDisplayName(student),
      pseudonym: student.studentPseudonym ?? undefined,
      revealedEmail: student.email ?? null,
    })
  }

  // No classes unlocked for this exam
  if (unlockedClasses.length === 0) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-3 mb-4">
        <p className="text-sm text-muted-foreground text-center">
          No classes have been unlocked for this exam yet.
        </p>
      </div>
    )
  }

  const getStateConfig = () => {
    switch (examState) {
      case 'open':
        return { color: 'bg-green-500', label: 'Open' }
      case 'lobby':
        return { color: 'bg-yellow-500', label: 'Lobby' }
      default:
        return { color: 'bg-red-500', label: 'Closed' }
    }
  }

  const stateConfig = getStateConfig()

  const getStatusIcon = (status: ExamRosterStudent['status']) => {
    switch (status) {
      case 'taking':
        return <Clock className="w-4 h-4 text-yellow-500" />
      case 'submitted':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      default:
        return <Circle className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getStatusLabel = (status: ExamRosterStudent['status']) => {
    switch (status) {
      case 'taking':
        return 'Taking exam'
      case 'submitted':
        return 'Submitted'
      default:
        return 'Not started'
    }
  }

  const formatTime = (dateString?: string) => {
    if (!dateString) return null
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    // Sticky to the top of #scroll-container so the class picker + state
    // controls stay reachable while the teacher scrolls through the exam.
    // `top-0` pins it flush; bumping z-index above the annotation overlay
    // (z-10) and code-editor floats (z-10) but below modals (z-50+).
    <div className="sticky top-0 z-30 bg-card border border-border rounded-lg mb-4 shadow-sm overflow-hidden">
      {/* Main toolbar bar */}
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Class Selector */}
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

          {/* Divider */}
          <div className="hidden sm:block w-px h-6 bg-border" />

          {/* State Dropdown - combined indicator and controls */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdating || !selectedClass}
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
                    <div className={cn(
                      'w-2 h-2 rounded-full',
                      stateConfig.color
                    )} />
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

          {/* Spacer */}
          <div className="flex-1" />

          {/* Viewing-state chip + back-out button. Visible only when the
              teacher has clicked a student row to enter snapshot-view mode. */}
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

          {/* Submitted-only toggle. Lives in shared context so the gutter
              navigator filters the same way. */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="Cycle only through students who have handed in">
            <input
              type="checkbox"
              checked={submittedOnly}
              onChange={(e) => setSubmittedOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>Submitted only</span>
          </label>

          {/* Student Counts (clickable to expand) */}
          {studentCounts && selectedClass && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-4 text-sm hover:bg-muted/50 rounded-md px-2 py-1 -mr-2 transition-colors"
            >
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{studentCounts.total}</span>
              </div>
              <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
                <Clock className="w-4 h-4" />
                <span>{studentCounts.taking}</span>
              </div>
              <div className="flex items-center gap-1 text-green-600 dark:text-green-500">
                <CheckCircle2 className="w-4 h-4" />
                <span>{studentCounts.submitted}</span>
              </div>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expandable student list */}
      {isExpanded && selectedClass && (
        <div className="border-t border-border">
          <div className="max-h-64 overflow-y-auto">
            {students.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No students in this class yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Student</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Email</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {students.map((student) => {
                    const isViewingThis = selectedStudent?.id === student.id
                    return (
                    <tr
                      key={student.id}
                      onClick={() => viewStudent(student)}
                      className={cn(
                        'cursor-pointer hover:bg-muted/30',
                        isViewingThis && 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50'
                      )}
                      title={isViewingThis ? 'Click to stop viewing' : "Click to view this student's work"}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate max-w-[200px]">
                            {getStudentDisplayName(student)}
                          </span>
                          {isViewingThis && <Eye className="w-3 h-3 text-amber-600 flex-shrink-0" />}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <span className="truncate max-w-[200px] block">
                          {student.email || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(student.status)}
                          <span className={
                            student.status === 'taking' ? 'text-yellow-600 dark:text-yellow-500' :
                            student.status === 'submitted' ? 'text-green-600 dark:text-green-500' :
                            'text-muted-foreground'
                          }>
                            {getStatusLabel(student.status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {student.status === 'taking' && formatTime(student.startedAt) && (
                          <span>Started {formatTime(student.startedAt)}</span>
                        )}
                        {student.status === 'submitted' && formatTime(student.submittedAt) && (
                          <span>At {formatTime(student.submittedAt)}</span>
                        )}
                        {student.status === 'not_started' && '-'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {student.status === 'submitted' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              // Don't bubble into the row's "view student" click.
                              e.stopPropagation()
                              reopenForStudent(student.id)
                            }}
                            disabled={reopeningStudent === student.id}
                            className="h-7 px-2 text-xs gap-1"
                            title="Allow student to retake exam"
                          >
                            {reopeningStudent === student.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                            Reopen
                          </Button>
                        )}
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
    </div>
  )
}
