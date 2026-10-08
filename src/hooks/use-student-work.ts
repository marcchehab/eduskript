'use client'

/**
 * Hook for teachers to fetch a student's work
 *
 * Fetches the student's personal annotations, code, snaps, etc.
 * from the /api/classes/[classId]/students/[studentId]/user-data endpoint.
 *
 * This allows teachers to see what students have drawn/written on a page.
 *
 * Subscribes to SSE events for real-time updates when the student saves.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtimeEvents } from './use-realtime-events'
import { useCurrentSite } from '@/contexts/current-site-context'

export interface StudentWorkData {
  annotations?: {
    data: { canvasData?: string; [key: string]: unknown }
    updatedAt: number
  }
  code?: {
    data: unknown
    updatedAt: number
  }
  snaps?: {
    data: unknown
    updatedAt: number
  }
  [key: string]: { data: unknown; updatedAt: number } | undefined
}

interface UseStudentWorkOptions {
  classId: string | null
  studentId: string | null
  pageId: string
  adapters?: string[]
}

interface UseStudentWorkResult {
  data: StudentWorkData | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

// Default adapters as a stable reference
const DEFAULT_ADAPTERS = ['annotations', 'code', 'snaps']

export function useStudentWork({
  classId,
  studentId,
  pageId,
  adapters
}: UseStudentWorkOptions): UseStudentWorkResult {
  // Site scoping: the student's data on THIS site only (src/lib/site-access.ts).
  const { siteId } = useCurrentSite()
  const [data, setData] = useState<StudentWorkData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stable reference for adapters - only update if content actually changes
  const adaptersRef = useRef<string[]>(adapters || DEFAULT_ADAPTERS)
  const adaptersKey = (adapters || DEFAULT_ADAPTERS).join(',')

  // Track last fetched key to avoid duplicate requests
  const lastFetchKeyRef = useRef<string>('')

  const fetchStudentWork = useCallback(async () => {
    if (!classId || !studentId || !pageId || !siteId) {
      setData(null)
      setIsLoading(false)
      return
    }

    // Create a unique key for this request
    const fetchKey = `${siteId}:${classId}:${studentId}:${pageId}:${adaptersKey}`

    // Skip if we already fetched this exact data
    if (lastFetchKeyRef.current === fetchKey && data !== null) {
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        pageId,
        siteId,
        adapters: adaptersRef.current.join(',')
      })

      const response = await fetch(
        `/api/classes/${classId}/students/${studentId}/user-data?${params}`
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || null)
      lastFetchKeyRef.current = fetchKey
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch student work')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [classId, studentId, pageId, siteId, adaptersKey, data])

  useEffect(() => {
    fetchStudentWork()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchStudentWork has `data` in its deps, including it here would cause infinite refetch
  }, [classId, studentId, pageId, siteId, adaptersKey])

  // Subscribe to real-time student work updates via SSE
  // When the student we're viewing saves their work, automatically refetch
  useRealtimeEvents(
    ['student-work-update'],
    (event) => {
      // Only refetch if this is the student we're currently viewing
      if (event.studentId === studentId && event.pageId === pageId && (!event.siteId || event.siteId === siteId)) {
        console.log('[useStudentWork] Received student-work-update, refetching...')
        // Clear the lastFetchKey to force a refetch
        lastFetchKeyRef.current = ''
        fetchStudentWork()
      }
    },
    { enabled: !!classId && !!studentId }
  )

  return {
    data,
    isLoading,
    error,
    refetch: fetchStudentWork
  }
}
