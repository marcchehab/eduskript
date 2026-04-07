'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Check, X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

interface SqlResponseItem {
  studentId: string
  displayName: string
  isCorrect: boolean | null  // null = not attempted
  submittedAt: number | null
}

interface SqlStats {
  correct: number
  incorrect: number
  notAttempted: number
  total: number
}

interface SqlProgressBarProps {
  classId: string
  className: string
  pageId: string
  componentId: string // e.g. "sql-verification-editor-abc"
}

export function SqlProgressBar({ classId, className, pageId, componentId }: SqlProgressBarProps) {
  const [stats, setStats] = useState<SqlStats | null>(null)
  const [responses, setResponses] = useState<SqlResponseItem[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchIdRef = useRef(0)
  const mountedRef = useRef(true)

  const fetchResponses = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    if (!mountedRef.current) return

    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageId, componentId })
      const res = await fetch(`/api/classes/${classId}/sql-responses?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!mountedRef.current || fetchId !== fetchIdRef.current) return
      if (!res.ok) throw new Error('Failed to fetch responses')
      const data = await res.json()
      if (!mountedRef.current || fetchId !== fetchIdRef.current) return
      setStats(data.stats)
      setResponses(data.responses)
    } catch {
      if (mountedRef.current) setError('Failed to load class responses')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [classId, pageId, componentId])

  // Real-time refresh when any student updates their work on this page
  useRealtimeEvents(
    ['student-work-update'],
    (event) => {
      if (event.type === 'student-work-update' && event.classId === classId && event.pageId === pageId) {
        fetchResponses()
      }
    },
    { enabled: true }
  )

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => { fetchResponses() }, [fetchResponses])

  if (isLoading && !stats) {
    return (
      <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-border animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 text-sm">
        {error}
      </div>
    )
  }

  if (!stats) return null

  const attempted = stats.correct + stats.incorrect
  const correctWidth  = stats.total > 0 ? (stats.correct     / stats.total) * 100 : 0
  const incorrectWidth = stats.total > 0 ? (stats.incorrect  / stats.total) * 100 : 0
  const notAttemptedWidth = stats.total > 0 ? (stats.notAttempted / stats.total) * 100 : 0

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{className}</span>
            <span>&bull;</span>
            <span>{attempted}/{stats.total} attempted</span>
            {stats.correct > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-green-600 dark:text-green-400">{stats.correct} correct</span>
              </>
            )}
            {stats.incorrect > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-red-600 dark:text-red-400">{stats.incorrect} incorrect</span>
              </>
            )}
          </div>
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>

        {/* Stacked progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          {correctWidth > 0 && (
            <div className="bg-green-500 transition-all duration-300" style={{ width: `${correctWidth}%` }} />
          )}
          {incorrectWidth > 0 && (
            <div className="bg-red-500 transition-all duration-300" style={{ width: `${incorrectWidth}%` }} />
          )}
          {notAttemptedWidth > 0 && (
            <div className="bg-gray-300 dark:bg-gray-600 transition-all duration-300" style={{ width: `${notAttemptedWidth}%` }} />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border divide-y divide-border">
          {responses.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No students in this class
            </div>
          ) : (
            responses
              .sort((a, b) => {
                // Attempted first, then correct > incorrect > not attempted
                const score = (r: SqlResponseItem) =>
                  r.isCorrect === true ? 2 : r.isCorrect === false ? 1 : 0
                return score(b) - score(a)
              })
              .map(r => (
                <div
                  key={r.studentId}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2 text-sm',
                    r.isCorrect === null && 'opacity-60'
                  )}
                >
                  <div className="flex-shrink-0">
                    {r.isCorrect === null
                      ? <Clock className="h-4 w-4 text-muted-foreground" />
                      : r.isCorrect
                        ? <Check className="h-4 w-4 text-green-500" />
                        : <X className="h-4 w-4 text-red-500" />}
                  </div>
                  <div className="flex-shrink-0 w-32 truncate font-medium">{r.displayName}</div>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {r.isCorrect === null
                      ? 'Not attempted yet'
                      : r.isCorrect
                        ? 'Correct'
                        : 'Incorrect (last attempt)'}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}
