'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Check, X, Clock, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'

interface PythonResponseItem {
  studentId: string
  pseudonym: string
  displayName: string
  testsPassed: number | null
  totalTests: number | null
  earnedPoints: number | null
  pointsMax: number | null
  /** Effective score source: 'check' | 'ai' | 'override' | 'preview' | null. */
  source: string | null
  submittedAt: number | null
}

const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const SOURCE_LABEL: Record<string, string> = { check: 'tests', ai: 'AI', override: 'manual', preview: 'preview' }

function resolveDisplayName(
  r: { pseudonym: string; displayName: string },
  mappings: Record<string, string>
): string {
  const mapped = r.pseudonym ? mappings[r.pseudonym] : null
  return mapped || r.displayName
}

interface PythonStats {
  fullPass: number
  partialPass: number
  failed: number
  notAttempted: number
  total: number
  averageScore: number
}

interface PythonProgressBarProps {
  classId: string
  className: string
  pageId: string
  componentId: string
}

export function PythonProgressBar({ classId, className, pageId, componentId }: PythonProgressBarProps) {
  const [stats, setStats] = useState<PythonStats | null>(null)
  const [responses, setResponses] = useState<PythonResponseItem[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvedEmails, setResolvedEmails] = useState<Record<string, string>>({})

  useEffect(() => {
    getReverseMappingsForClass(classId)
      .then(setResolvedEmails)
      .catch(() => setResolvedEmails({}))
  }, [classId])

  const fetchIdRef = useRef(0)
  const mountedRef = useRef(true)

  const fetchResponses = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    if (!mountedRef.current) return

    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageId, componentId })
      const res = await fetch(`/api/classes/${classId}/python-responses?${params}`, {
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

  const attempted = stats.fullPass + stats.partialPass + stats.failed
  const fullPassWidth = stats.total > 0 ? (stats.fullPass / stats.total) * 100 : 0
  const partialWidth = stats.total > 0 ? (stats.partialPass / stats.total) * 100 : 0
  const failedWidth = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0
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
            {stats.fullPass > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-green-600 dark:text-green-400">{stats.fullPass} all passed</span>
              </>
            )}
            {stats.partialPass > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-yellow-600 dark:text-yellow-400">{stats.partialPass} partial</span>
              </>
            )}
            {stats.averageScore > 0 && (
              <>
                <span>&bull;</span>
                <span>{Math.round(stats.averageScore)}% average</span>
              </>
            )}
          </div>
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>

        {/* Three-segment progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          {fullPassWidth > 0 && (
            <div className="bg-green-500 transition-all duration-300" style={{ width: `${fullPassWidth}%` }} />
          )}
          {partialWidth > 0 && (
            <div className="bg-yellow-500 transition-all duration-300" style={{ width: `${partialWidth}%` }} />
          )}
          {failedWidth > 0 && (
            <div className="bg-red-500 transition-all duration-300" style={{ width: `${failedWidth}%` }} />
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
                // Sort by effective score ratio descending, unattempted last.
                const score = (r: PythonResponseItem) =>
                  r.source === null ? -1 : (r.earnedPoints ?? 0) / (r.pointsMax || 1)
                return score(b) - score(a)
              })
              .map(r => {
                const attempted = r.source !== null
                const ratio = attempted && r.pointsMax ? (r.earnedPoints ?? 0) / r.pointsMax : 0
                return (
                  <div
                    key={r.studentId}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2 text-sm',
                      !attempted && 'opacity-60'
                    )}
                  >
                    <div className="shrink-0">
                      {!attempted
                        ? <Clock className="h-4 w-4 text-muted-foreground" />
                        : ratio >= 1
                          ? <Check className="h-4 w-4 text-green-500" />
                          : (r.earnedPoints ?? 0) > 0
                            ? <Minus className="h-4 w-4 text-yellow-500" />
                            : <X className="h-4 w-4 text-red-500" />}
                    </div>
                    <div className="shrink-0 w-32 truncate font-medium">{resolveDisplayName(r, resolvedEmails)}</div>
                    <div className="flex-1 text-xs text-muted-foreground">
                      {!attempted ? (
                        'Not attempted yet'
                      ) : (
                        <>
                          <span className="tabular-nums text-foreground">
                            {fmtPts(r.earnedPoints ?? 0)}/{fmtPts(r.pointsMax ?? 0)} pts
                          </span>
                          {r.source && <span className="ml-1">({SOURCE_LABEL[r.source] ?? r.source})</span>}
                          {r.totalTests !== null && <span className="ml-1.5">· {r.testsPassed}/{r.totalTests} tests</span>}
                        </>
                      )}
                    </div>
                  </div>
                )
              })
          )}
        </div>
      )}
    </div>
  )
}
