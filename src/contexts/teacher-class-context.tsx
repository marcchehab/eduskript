'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'

const STORAGE_KEY = 'eduskript-teacher-class'

interface SelectedClass {
  id: string
  name: string
}

interface TeacherClassContextValue {
  selectedClass: SelectedClass | null
  setSelectedClass: (classData: SelectedClass | null) => void
  isTeacher: boolean
  isLoading: boolean
}

const TeacherClassContext = createContext<TeacherClassContextValue | null>(null)

export function TeacherClassProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const [selectedClass, setSelectedClassState] = useState<SelectedClass | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isTeacher = session?.user?.accountType === 'teacher'

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as SelectedClass
        if (parsed.id && parsed.name) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedClassState(parsed)
        }
      }
    } catch (e) {
      // Invalid stored data, ignore
      console.warn('Failed to parse stored teacher class:', e)
    }
    setIsLoading(false)
  }, [])

  const setSelectedClass = useCallback((classData: SelectedClass | null) => {
    setSelectedClassState(classData)

    if (typeof window === 'undefined') return

    if (classData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(classData))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // Clear selection if user is not a teacher
  useEffect(() => {
    if (status === 'loading') return
    if (!isTeacher && selectedClass) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedClass(null)
    }
  }, [isTeacher, selectedClass, setSelectedClass, status])

  return (
    <TeacherClassContext.Provider
      value={{
        selectedClass,
        setSelectedClass,
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
      isTeacher: false,
      isLoading: false,
    }
  }
  return context
}
