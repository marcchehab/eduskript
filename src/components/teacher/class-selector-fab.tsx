'use client'

import { useState, useEffect, useRef } from 'react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { ChevronDown, Users, X } from 'lucide-react'

interface ClassInfo {
  id: string
  name: string
  _count: {
    memberships: number
  }
}

export function ClassSelectorFAB() {
  const { selectedClass, setSelectedClass, isTeacher, isLoading } = useTeacherClass()
  const [isOpen, setIsOpen] = useState(false)
  const [classes, setClasses] = useState<ClassInfo[]>([])
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
    setIsOpen(false)
  }

  const handleClearSelection = () => {
    setSelectedClass(null)
    setIsOpen(false)
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed bottom-6 right-6 z-50"
    >
      {/* Dropdown menu - appears above the button */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border bg-muted/50">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Select Class to View
            </span>
          </div>

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
                      {cls._count.memberships}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

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

      {/* FAB button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all ${
          selectedClass
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-card text-foreground border border-border hover:bg-muted'
        }`}
      >
        <Users className="h-5 w-5" />
        <span className="font-medium max-w-32 truncate">
          {selectedClass ? selectedClass.name : 'Select Class'}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  )
}
