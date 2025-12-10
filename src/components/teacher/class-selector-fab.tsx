'use client'

import { useState, useEffect, useRef } from 'react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { ChevronDown, Users, X, User, Radio } from 'lucide-react'

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

  // Separate open states for each dropdown
  const [isClassesOpen, setIsClassesOpen] = useState(false)
  const [isTargetsOpen, setIsTargetsOpen] = useState(false)

  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [students, setStudents] = useState<StudentInfo[]>([])
  const [isFetchingClasses, setIsFetchingClasses] = useState(false)
  const [isFetchingStudents, setIsFetchingStudents] = useState(false)

  const classesDropdownRef = useRef<HTMLDivElement>(null)
  const targetsDropdownRef = useRef<HTMLDivElement>(null)

  // Fetch classes when classes dropdown opens
  useEffect(() => {
    if (!isTeacher || isLoading || !isClassesOpen || classes.length > 0) return

    const fetchClasses = async () => {
      setIsFetchingClasses(true)
      try {
        const res = await fetch('/api/classes')
        if (res.ok) {
          const data = await res.json()
          setClasses(data.classes || [])
        }
      } catch (e) {
        console.error('Failed to fetch classes:', e)
      } finally {
        setIsFetchingClasses(false)
      }
    }

    fetchClasses()
  }, [isClassesOpen, classes.length, isTeacher, isLoading])

  // Fetch students when a class is selected and targets dropdown opens
  useEffect(() => {
    if (!selectedClass || !isTargetsOpen) return

    const fetchStudents = async () => {
      setIsFetchingStudents(true)
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
        setIsFetchingStudents(false)
      }
    }

    fetchStudents()
  }, [selectedClass, isTargetsOpen])

  // Refetch students when class changes (if targets menu is open)
  useEffect(() => {
    if (!selectedClass) {
      setStudents([])
    }
  }, [selectedClass?.id])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isClassesOpen && classesDropdownRef.current && !classesDropdownRef.current.contains(e.target as Node)) {
        setIsClassesOpen(false)
      }
      if (isTargetsOpen && targetsDropdownRef.current && !targetsDropdownRef.current.contains(e.target as Node)) {
        setIsTargetsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isClassesOpen, isTargetsOpen])

  // Don't render for non-teachers
  if (!isTeacher || isLoading) {
    return null
  }

  const handleSelectClass = (classInfo: ClassInfo) => {
    setSelectedClass({ id: classInfo.id, name: classInfo.name })
    // Clear student selection when changing class
    setSelectedStudent(null)
    setIsClassesOpen(false)
  }

  const handleSelectStudent = (student: StudentInfo) => {
    setSelectedStudent({
      id: student.id,
      displayName: student.displayName,
      pseudonym: student.pseudonym,
    })
    setIsTargetsOpen(false)
  }

  const handleSelectEntireClass = () => {
    setSelectedStudent(null)
    setIsTargetsOpen(false)
  }

  const handleClearSelection = () => {
    setSelectedClass(null)
    setSelectedStudent(null)
    setIsClassesOpen(false)
    setIsTargetsOpen(false)
  }

  // Get display text for targets FAB
  const getTargetText = () => {
    if (selectedStudent) return selectedStudent.displayName
    return 'Entire Class'
  }

  // Get icon for targets FAB
  const getTargetIcon = () => {
    if (viewMode === 'student-view') return <User className="h-5 w-5" />
    return <Radio className="h-5 w-5" />
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-end gap-2">
      {/* Targets FAB - only visible when class is selected */}
      {selectedClass && (
        <div ref={targetsDropdownRef} className="relative">
          {/* Targets dropdown menu */}
          {isTargetsOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-64 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
              {/* Header */}
              <div className="p-2 border-b border-border bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Broadcast Target
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto">
                {/* Broadcast to entire class option */}
                <button
                  onClick={handleSelectEntireClass}
                  className={`w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-center gap-2 border-b border-border ${
                    !selectedStudent ? 'bg-primary/10 text-primary' : ''
                  }`}
                >
                  <Radio className="h-4 w-4" />
                  <span className="font-medium">Entire Class</span>
                </button>

                {/* Students list */}
                {isFetchingStudents ? (
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
            </div>
          )}

          {/* Targets FAB button */}
          <button
            onClick={() => {
              setIsTargetsOpen(!isTargetsOpen)
              setIsClassesOpen(false) // Close other dropdown
            }}
            className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all ${
              selectedStudent
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {getTargetIcon()}
            <span className="font-medium max-w-32 truncate">
              {getTargetText()}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isTargetsOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      )}

      {/* Classes FAB */}
      <div ref={classesDropdownRef} className="relative">
        {/* Classes dropdown menu */}
        {isClassesOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-64 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            {/* Header */}
            <div className="p-2 border-b border-border bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Select Class
              </span>
            </div>

            {/* Classes list */}
            <div className="max-h-64 overflow-y-auto">
              {isFetchingClasses ? (
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

            {/* Clear selection option */}
            {selectedClass && (
              <div className="border-t border-border">
                <button
                  onClick={handleClearSelection}
                  className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Clear selection
                </button>
              </div>
            )}
          </div>
        )}

        {/* Classes FAB button */}
        <button
          onClick={() => {
            setIsClassesOpen(!isClassesOpen)
            setIsTargetsOpen(false) // Close other dropdown
          }}
          className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all ${
            selectedClass
              ? 'bg-muted text-foreground border border-border hover:bg-muted/80'
              : 'bg-card text-foreground border border-border hover:bg-muted'
          }`}
        >
          <Users className="h-5 w-5" />
          <span className="font-medium max-w-32 truncate">
            {selectedClass ? selectedClass.name : 'Select Class'}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isClassesOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </div>
  )
}
