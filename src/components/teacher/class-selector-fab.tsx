'use client'

import { useState, useEffect, useRef } from 'react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { ChevronDown, Users, X, User, Radio, ArrowLeft } from 'lucide-react'

interface ClassInfo {
  id: string
  name: string
  memberCount: number
}

interface StudentInfo {
  id: string
  displayName: string
  pseudonym?: string
  email?: string
}

type MenuState = 'classes' | 'students'

export function ClassSelectorFAB() {
  const {
    selectedClass,
    setSelectedClass,
    selectedStudent,
    setSelectedStudent,
    viewMode,
    isTeacher,
    isLoading
  } = useTeacherClass()
  const [isOpen, setIsOpen] = useState(false)
  const [menuState, setMenuState] = useState<MenuState>('classes')
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [students, setStudents] = useState<StudentInfo[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch classes when dropdown opens
  useEffect(() => {
    // Skip if not teacher or loading, or dropdown is closed, or already have classes
    if (!isTeacher || isLoading || !isOpen || classes.length > 0) return

    const fetchClasses = async () => {
      setIsFetching(true)
      try {
        const res = await fetch('/api/classes')
        if (res.ok) {
          const data = await res.json()
          setClasses(data.classes || [])
        }
      } catch (e) {
        console.error('Failed to fetch classes:', e)
      } finally {
        setIsFetching(false)
      }
    }

    fetchClasses()
  }, [isOpen, classes.length, isTeacher, isLoading])

  // Fetch students when viewing student list for a class
  useEffect(() => {
    if (!selectedClass || menuState !== 'students') return

    const fetchStudents = async () => {
      setIsFetching(true)
      setStudents([])
      try {
        const res = await fetch(`/api/classes/${selectedClass.id}/students`)
        if (res.ok) {
          const data = await res.json()
          setStudents(data.students || [])
        }
      } catch (e) {
        console.error('Failed to fetch students:', e)
      } finally {
        setIsFetching(false)
      }
    }

    fetchStudents()
  }, [selectedClass, menuState])

  // Reset menu state when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      // Delay reset to prevent flash during close animation
      const timer = setTimeout(() => setMenuState('classes'), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Don't render for non-teachers
  if (!isTeacher || isLoading) {
    return null
  }

  const handleSelectClass = (classInfo: ClassInfo) => {
    setSelectedClass({ id: classInfo.id, name: classInfo.name })
    // Show students menu after selecting a class
    setMenuState('students')
  }

  const handleSelectStudent = (student: StudentInfo) => {
    setSelectedStudent({
      id: student.id,
      displayName: student.displayName,
      pseudonym: student.pseudonym,
    })
    setIsOpen(false)
  }

  const handleBackToClasses = () => {
    setMenuState('classes')
  }

  const handleClearStudent = () => {
    setSelectedStudent(null)
  }

  const handleClearSelection = () => {
    setSelectedClass(null)
    setIsOpen(false)
  }

  // Get display text for FAB button
  const getButtonText = () => {
    if (selectedStudent) return selectedStudent.displayName
    if (selectedClass) return selectedClass.name
    return 'Select Class'
  }

  // Get icon for current mode
  const getModeIcon = () => {
    if (viewMode === 'student-view') return <User className="h-5 w-5" />
    if (viewMode === 'class-broadcast') return <Radio className="h-5 w-5" />
    return <Users className="h-5 w-5" />
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed bottom-6 right-6 z-50"
    >
      {/* Dropdown menu - appears above the button */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="p-2 border-b border-border bg-muted/50 flex items-center gap-2">
            {menuState === 'students' && (
              <button
                onClick={handleBackToClasses}
                className="p-1 hover:bg-muted rounded transition-colors"
                title="Back to classes"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {menuState === 'classes' ? 'Select Class' : `${selectedClass?.name} - Students`}
            </span>
          </div>

          {/* Classes list */}
          {menuState === 'classes' && (
            <div className="max-h-64 overflow-y-auto">
              {isFetching ? (
                <div className="p-4 text-center text-muted-foreground">
                  Loading classes...
                </div>
              ) : classes.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  No classes found
                </div>
              ) : (
                <div className="py-1">
                  {classes.map((cls) => (
                    <button
                      key={cls.id}
                      onClick={() => handleSelectClass(cls)}
                      className={`w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-center justify-between ${
                        selectedClass?.id === cls.id ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      <span className="font-medium truncate">{cls.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {cls.memberCount}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Students list */}
          {menuState === 'students' && (
            <div className="max-h-64 overflow-y-auto">
              {/* Broadcast to class option */}
              <button
                onClick={() => {
                  setSelectedStudent(null)
                  setIsOpen(false)
                }}
                className={`w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-center gap-2 border-b border-border ${
                  !selectedStudent ? 'bg-primary/10 text-primary' : ''
                }`}
              >
                <Radio className="h-4 w-4" />
                <span className="font-medium">Broadcast to Class</span>
              </button>

              {isFetching ? (
                <div className="p-4 text-center text-muted-foreground">
                  Loading students...
                </div>
              ) : students.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  No students in this class
                </div>
              ) : (
                <div className="py-1">
                  {students.map((student) => (
                    <button
                      key={student.id}
                      onClick={() => handleSelectStudent(student)}
                      className={`w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                        selectedStudent?.id === student.id ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium truncate">{student.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Clear selection option */}
          {selectedClass && (
            <div className="border-t border-border">
              {selectedStudent && (
                <button
                  onClick={handleClearStudent}
                  className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Back to class broadcast
                </button>
              )}
              <button
                onClick={handleClearSelection}
                className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                Clear selection (My View)
              </button>
            </div>
          )}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all ${
          selectedStudent
            ? 'bg-orange-500 text-white hover:bg-orange-600'
            : selectedClass
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-card text-foreground border border-border hover:bg-muted'
        }`}
      >
        {getModeIcon()}
        <span className="font-medium max-w-36 truncate">
          {getButtonText()}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  )
}
