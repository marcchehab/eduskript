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

export interface TeacherIndividualFeedback {
  data: unknown
  updatedAt: number
}

export interface TeacherBroadcastData {
  classAnnotations: TeacherClassAnnotation[]
  individualFeedback: TeacherIndividualFeedback | null
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
  const [individualFeedback, setIndividualFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch teacher annotations from API
  // IMPORTANT: Server is always the source of truth for teacher annotations.
  // We clear local state before fetching to ensure stale data is never shown.
  const fetchAnnotations = useCallback(async () => {
    if (status !== 'authenticated' || !pageId) {
      setIsLoading(false)
      return
    }

    try {
      setError(null)
      setIsLoading(true)

      // Clear local state BEFORE fetching to ensure server always wins
      // This prevents showing stale data if teacher deleted annotations while student was offline
      setClassAnnotations([])
      setIndividualFeedback(null)

      // Add timestamp to prevent browser caching
      const res = await fetch(`/api/student/teacher-annotations?pageId=${encodeURIComponent(pageId)}&_t=${Date.now()}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }

      const data: TeacherBroadcastData = await res.json()
      console.log('[useTeacherBroadcast] Fetched data:', {
        classAnnotationsCount: data.classAnnotations?.length ?? 0,
        hasIndividualFeedback: !!data.individualFeedback
      })
      setClassAnnotations(data.classAnnotations || [])
      setIndividualFeedback(data.individualFeedback || null)
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
  useRealtimeEvents(
    ['teacher-annotations-update', 'teacher-feedback'],
    (event) => {
      console.log('[useTeacherBroadcast] Received SSE event:', event.type, 'pageId:', (event as { pageId?: string }).pageId, 'current pageId:', pageId)
      // Check if event is for this page
      if (event.type === 'teacher-annotations-update') {
        if (event.pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching class annotations')
          // Refetch to get updated class annotations
          fetchAnnotations()
        }
      } else if (event.type === 'teacher-feedback') {
        if (event.pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching individual feedback')
          // Refetch to get updated individual feedback
          fetchAnnotations()
        }
      }
    },
    { enabled: status === 'authenticated' }
  )

  return {
    classAnnotations,
    individualFeedback,
    isLoading,
    error,
    refetch: fetchAnnotations,
  }
}
