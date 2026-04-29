'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { createLogger } from '@/lib/logger'

const log = createLogger('teacher:context')

const STORAGE_KEY = 'eduskript-teacher-class'
const STUDENT_STORAGE_KEY = 'eduskript-teacher-selected-student'
const PAGE_BROADCAST_KEY = 'eduskript-page-broadcast'

interface SelectedClass {
  id: string
  name: string
}

interface SelectedStudent {
  id: string
  displayName: string
  pseudonym?: string
  /** Real email — only present when ClassMembership.identityConsent is true. */
  revealedEmail?: string | null
}

/**
 * View mode determines how the teacher's annotations are handled:
 * - 'my-view': Teacher's personal annotations (no targeting)
 * - 'class-broadcast': Teacher broadcasts to entire class
 * - 'student-view': Teacher viewing/annotating individual student's work
 * - 'page-broadcast': Author broadcasts to all page visitors (public annotations)
 */
export type ViewMode = 'my-view' | 'class-broadcast' | 'student-view' | 'page-broadcast'

interface TeacherClassContextValue {
  selectedClass: SelectedClass | null
  setSelectedClass: (classData: SelectedClass | null) => void
  selectedStudent: SelectedStudent | null
  setSelectedStudent: (student: SelectedStudent | null) => void
  /** When true, broadcasts to all page visitors (requires author permission) */
  broadcastToPage: boolean
  setBroadcastToPage: (broadcast: boolean) => void
  viewMode: ViewMode
  isTeacher: boolean
  isLoading: boolean
}

const TeacherClassContext = createContext<TeacherClassContextValue | null>(null)

export function TeacherClassProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const [selectedClass, setSelectedClassState] = useState<SelectedClass | null>(null)
  const [selectedStudent, setSelectedStudentState] = useState<SelectedStudent | null>(null)
  const [broadcastToPage, setBroadcastToPageState] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const isTeacher = session?.user?.accountType === 'teacher'

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const storedClass = localStorage.getItem(STORAGE_KEY)
      if (storedClass) {
        const parsed = JSON.parse(storedClass) as SelectedClass
        if (parsed.id && parsed.name) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedClassState(parsed)
        }
      }

      const storedStudent = localStorage.getItem(STUDENT_STORAGE_KEY)
      if (storedStudent) {
        const parsed = JSON.parse(storedStudent) as SelectedStudent
        if (parsed.id && parsed.displayName) {
          setSelectedStudentState(parsed)
        }
      }

      const storedPageBroadcast = localStorage.getItem(PAGE_BROADCAST_KEY)
      if (storedPageBroadcast === 'true') {
        setBroadcastToPageState(true)
      }
    } catch (e) {
      // Invalid stored data, ignore
      console.warn('Failed to parse stored teacher selection:', e)
    }
    setIsLoading(false)
  }, [])

  const setSelectedClass = useCallback((classData: SelectedClass | null) => {
    log('setSelectedClass called', { id: classData?.id, name: classData?.name })
    setSelectedClassState(classData)
    // Clear student selection and page broadcast when class changes
    setSelectedStudentState(null)
    setBroadcastToPageState(false)

    if (typeof window === 'undefined') return

    if (classData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(classData))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    // Always clear student and page broadcast when class changes
    localStorage.removeItem(STUDENT_STORAGE_KEY)
    localStorage.removeItem(PAGE_BROADCAST_KEY)
  }, [])

  const setSelectedStudent = useCallback((student: SelectedStudent | null) => {
    log('setSelectedStudent called', { id: student?.id, displayName: student?.displayName })
    setSelectedStudentState(student)
    // Clear page broadcast when selecting a student
    setBroadcastToPageState(false)

    if (typeof window === 'undefined') return

    if (student) {
      localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(student))
    } else {
      localStorage.removeItem(STUDENT_STORAGE_KEY)
    }
    localStorage.removeItem(PAGE_BROADCAST_KEY)
  }, [])

  const setBroadcastToPage = useCallback((broadcast: boolean) => {
    log('setBroadcastToPage called', { broadcast })
    setBroadcastToPageState(broadcast)
    // Clear class/student selection when enabling page broadcast
    if (broadcast) {
      setSelectedClassState(null)
      setSelectedStudentState(null)
    }

    if (typeof window === 'undefined') return

    if (broadcast) {
      localStorage.setItem(PAGE_BROADCAST_KEY, 'true')
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STUDENT_STORAGE_KEY)
    } else {
      localStorage.removeItem(PAGE_BROADCAST_KEY)
    }
  }, [])

  // Derive view mode from selections
  const viewMode: ViewMode = useMemo(() => {
    let mode: ViewMode = 'my-view'
    if (broadcastToPage) mode = 'page-broadcast'
    else if (selectedStudent) mode = 'student-view'
    else if (selectedClass) mode = 'class-broadcast'
    log('viewMode computed', { mode, broadcastToPage, selectedClassId: selectedClass?.id, selectedStudentId: selectedStudent?.id })
    return mode
  }, [broadcastToPage, selectedClass, selectedStudent])

  // Clear selection if user is not a teacher
  useEffect(() => {
    if (status === 'loading') return
    if (!isTeacher && (selectedClass || selectedStudent)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedClass(null)
    }
  }, [isTeacher, selectedClass, selectedStudent, setSelectedClass, status])

  return (
    <TeacherClassContext.Provider
      value={{
        selectedClass,
        setSelectedClass,
        selectedStudent,
        setSelectedStudent,
        broadcastToPage,
        setBroadcastToPage,
        viewMode,
        isTeacher,
        isLoading: isLoading || status === 'loading',
      }}
    >
      {children}
    </TeacherClassContext.Provider>
  )
}

export function useTeacherClass() {
  const context = useContext(TeacherClassContext)
  if (!context) {
    // Return a safe default when used outside provider (e.g., in dashboard preview)
    return {
      selectedClass: null,
      setSelectedClass: () => {},
      selectedStudent: null,
      setSelectedStudent: () => {},
      broadcastToPage: false,
      setBroadcastToPage: () => {},
      viewMode: 'my-view' as ViewMode,
      isTeacher: false,
      isLoading: false,
    }
  }
  return context
}
