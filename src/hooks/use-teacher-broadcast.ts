'use client'

/**
 * Hook for students to receive teacher annotations
 *
 * Fetches teacher annotations (class broadcasts and individual feedback)
 * and subscribes to real-time updates via SSE.
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeEvents } from './use-realtime-events'

export interface TeacherClassAnnotation {
  classId: string
  className: string
  data: unknown
  updatedAt: number
}

export interface TeacherClassSnaps {
  classId: string
  className: string
  data: unknown
  updatedAt: number
}

export interface TeacherIndividualFeedback {
  data: unknown
  updatedAt: number
}

export interface TeacherBroadcastData {
  classAnnotations: TeacherClassAnnotation[]
  classSnaps: TeacherClassSnaps[]
  individualFeedback: TeacherIndividualFeedback | null
  individualSnapFeedback: TeacherIndividualFeedback | null
}

/**
 * Hook to receive teacher annotations for a specific page
 *
 * @param pageId - The page ID to fetch annotations for
 * @returns Object with teacher annotations and loading state
 */
export function useTeacherBroadcast(pageId: string) {
  const { status } = useSession()
  const [classAnnotations, setClassAnnotations] = useState<TeacherClassAnnotation[]>([])
  const [classSnaps, setClassSnaps] = useState<TeacherClassSnaps[]>([])
  const [individualFeedback, setIndividualFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualSnapFeedback, setIndividualSnapFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch teacher annotations from API
  // Uses SWR pattern: keep showing stale data while fetching, then swap when ready.
  // This prevents UI flicker during refetch.
  const fetchAnnotations = useCallback(async () => {
    if (status !== 'authenticated' || !pageId) {
      setIsLoading(false)
      return
    }

    try {
      setError(null)
      // Don't set isLoading=true on refetch - keeps stale data visible (SWR pattern)
      // Only set loading on initial fetch (when we have no data yet)

      // Add timestamp to prevent browser caching
      const res = await fetch(`/api/student/teacher-annotations?pageId=${encodeURIComponent(pageId)}&_t=${Date.now()}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }

      const data: TeacherBroadcastData = await res.json()
      console.log('[useTeacherBroadcast] Fetched data:', {
        classAnnotationsCount: data.classAnnotations?.length ?? 0,
        classSnapsCount: data.classSnaps?.length ?? 0,
        hasIndividualFeedback: !!data.individualFeedback,
        hasIndividualSnapFeedback: !!data.individualSnapFeedback
      })
      setClassAnnotations(data.classAnnotations || [])
      setClassSnaps(data.classSnaps || [])
      setIndividualFeedback(data.individualFeedback || null)
      setIndividualSnapFeedback(data.individualSnapFeedback || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch teacher annotations')
    } finally {
      setIsLoading(false)
    }
  }, [pageId, status])

  // Initial fetch
  useEffect(() => {
    fetchAnnotations()
  }, [fetchAnnotations])

  // Subscribe to real-time updates
  // Note: Snaps share the same SSE events as annotations (teacher-annotations-update, teacher-feedback)
  // since both are fetched together in a single API call
  useRealtimeEvents(
    ['teacher-annotations-update', 'teacher-feedback'],
    (event) => {
      console.log('[useTeacherBroadcast] Received SSE event:', event.type, 'pageId:', (event as { pageId?: string }).pageId, 'current pageId:', pageId)
      // Check if event is for this page
      if (event.type === 'teacher-annotations-update') {
        if (event.pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching class broadcasts')
          // Refetch to get updated class data (annotations + snaps)
          fetchAnnotations()
        }
      } else if (event.type === 'teacher-feedback') {
        if (event.pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching individual feedback')
          // Refetch to get updated individual feedback (annotations + snaps)
          fetchAnnotations()
        }
      }
    },
    { enabled: status === 'authenticated' }
  )

  return {
    classAnnotations,
    classSnaps,
    individualFeedback,
    individualSnapFeedback,
    isLoading,
    error,
    refetch: fetchAnnotations,
  }
}
