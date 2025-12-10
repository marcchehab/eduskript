'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'

const STORAGE_KEY = 'eduskript-teacher-class'
const STUDENT_STORAGE_KEY = 'eduskript-teacher-selected-student'

interface SelectedClass {
  id: string
  name: string
}

interface SelectedStudent {
  id: string
  displayName: string
  pseudonym?: string
}

/**
 * View mode determines how the teacher's annotations are handled:
 * - 'my-view': Teacher's personal annotations (no targeting)
 * - 'class-broadcast': Teacher broadcasts to entire class
 * - 'student-view': Teacher viewing/annotating individual student's work
 */
export type ViewMode = 'my-view' | 'class-broadcast' | 'student-view'

interface TeacherClassContextValue {
  selectedClass: SelectedClass | null
  setSelectedClass: (classData: SelectedClass | null) => void
  selectedStudent: SelectedStudent | null
  setSelectedStudent: (student: SelectedStudent | null) => void
  viewMode: ViewMode
  isTeacher: boolean
  isLoading: boolean
}

const TeacherClassContext = createContext<TeacherClassContextValue | null>(null)

export function TeacherClassProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const [selectedClass, setSelectedClassState] = useState<SelectedClass | null>(null)
  const [selectedStudent, setSelectedStudentState] = useState<SelectedStudent | null>(null)
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
    } catch (e) {
      // Invalid stored data, ignore
      console.warn('Failed to parse stored teacher selection:', e)
    }
    setIsLoading(false)
  }, [])

  const setSelectedClass = useCallback((classData: SelectedClass | null) => {
    setSelectedClassState(classData)
    // Clear student selection when class changes
    setSelectedStudentState(null)

    if (typeof window === 'undefined') return

    if (classData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(classData))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    // Always clear student when class changes
    localStorage.removeItem(STUDENT_STORAGE_KEY)
  }, [])

  const setSelectedStudent = useCallback((student: SelectedStudent | null) => {
    setSelectedStudentState(student)

    if (typeof window === 'undefined') return

    if (student) {
      localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(student))
    } else {
      localStorage.removeItem(STUDENT_STORAGE_KEY)
    }
  }, [])

  // Derive view mode from selections
  const viewMode: ViewMode = useMemo(() => {
    if (selectedStudent) return 'student-view'
    if (selectedClass) return 'class-broadcast'
    return 'my-view'
  }, [selectedClass, selectedStudent])

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
      viewMode: 'my-view' as ViewMode,
      isTeacher: false,
      isLoading: false,
    }
  }
  return context
}
