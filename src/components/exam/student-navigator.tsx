'use client'

/**
 * Prev/Next gutter arrows for cycling through the class roster while viewing
 * student work on the exam page. Same UI doubles for live monitoring during
 * an active exam (cycle through `taking` / `not_started` students) and for
 * post-submission review (cycle through `submitted` students).
 *
 * Filtering follows the `submittedOnly` toggle in the exam toolbar so both
 * controls stay in sync.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useExamRoster, type ExamRosterStudent } from '@/hooks/use-exam-roster'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { compareRoster } from '@/lib/exam-roster-order'

interface StudentNavigatorProps {
  pageId: string
}

export function StudentNavigator({ pageId }: StudentNavigatorProps) {
  const {
    selectedClass,
    selectedStudent,
    setSelectedStudent,
    submittedOnly,
    isTeacher,
  } = useTeacherClass()

  const enabled = isTeacher && Boolean(selectedClass)
  const { students } = useExamRoster({
    pageId,
    classId: selectedClass?.id ?? null,
    enabled,
  })

  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!selectedClass) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: clear cached mappings when the class is unselected.
      setResolvedEmails({})
      return
    }
    let cancelled = false
    getReverseMappingsForClass(selectedClass.id)
      .then((mappings) => { if (!cancelled) setResolvedEmails(mappings) })
      .catch(() => { if (!cancelled) setResolvedEmails({}) })
    return () => { cancelled = true }
  }, [selectedClass])

  const displayName = useCallback((s: ExamRosterStudent) => {
    const resolved = s.studentPseudonym ? resolvedEmails[s.studentPseudonym] : null
    if (resolved) return resolved
    if (s.name) return s.name
    return '—'
  }, [resolvedEmails])

  // Filtered list the arrows cycle through, in the canonical roster order
  // (shared with the ClassToolbar list so the arrows match the list).
  const ordered = useMemo(() => {
    const filtered = submittedOnly ? students.filter((s) => s.status === 'submitted') : students
    return [...filtered].sort((a, b) =>
      compareRoster({ status: a.status, name: displayName(a) }, { status: b.status, name: displayName(b) }),
    )
  }, [students, submittedOnly, displayName])

  const currentIndex = selectedStudent
    ? ordered.findIndex((s) => s.id === selectedStudent.id)
    : -1

  const go = (delta: number) => {
    if (ordered.length === 0) return
    const startIdx = currentIndex >= 0 ? currentIndex : (delta > 0 ? -1 : 0)
    const nextIdx = (startIdx + delta + ordered.length) % ordered.length
    const target = ordered[nextIdx]
    setSelectedStudent({
      id: target.id,
      displayName: displayName(target),
      pseudonym: target.studentPseudonym ?? undefined,
      revealedEmail: target.email ?? null,
    })
  }

  // Hide the navigator entirely when there's nothing to navigate. Teachers
  // viewing their own exam page with no class picked, or no students yet,
  // shouldn't see floating arrows.
  if (!enabled || ordered.length === 0) return null

  const positionText = selectedStudent && currentIndex >= 0
    ? `${currentIndex + 1} / ${ordered.length}`
    : `— / ${ordered.length}`

  // Portal to document.body so `position: fixed` is anchored to the viewport
  // and isn't trapped by an ancestor with `transform` (AnnotationLayer puts
  // a transform on <main> while page-zoom is non-1, which would otherwise
  // pin the arrows to the transformed content instead of the viewport).
  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous student"
        // On wide screens the public sidebar occupies the left edge (≥1344px,
        // ml-80); shift the arrow right of it so it isn't hidden behind it.
        className="fixed left-2 min-[1344px]:left-84 top-1/2 -translate-y-1/2 z-40 h-16 w-10 rounded-r-lg bg-card/90 hover:bg-card border border-l-0 border-border shadow-lg flex items-center justify-center text-foreground/70 hover:text-foreground transition-colors backdrop-blur-xs"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next student"
        className="fixed right-2 top-1/2 -translate-y-1/2 z-40 h-16 w-10 rounded-l-lg bg-card/90 hover:bg-card border border-r-0 border-border shadow-lg flex items-center justify-center text-foreground/70 hover:text-foreground transition-colors backdrop-blur-xs"
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Position chip — anchored under the right arrow so the teacher knows
          where they are in the roster without expanding the toolbar. */}
      <div className="fixed right-2 top-[calc(50%+44px)] z-40 px-2 py-0.5 rounded-md bg-card/90 border border-border shadow-xs text-[11px] text-muted-foreground backdrop-blur-xs">
        {positionText}
      </div>
    </>,
    document.body
  )
}
