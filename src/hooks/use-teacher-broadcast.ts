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
  const fetchAnnotations = useCallback(async () => {
    if (status !== 'authenticated' || !pageId) {
      setIsLoading(false)
      return
    }

    try {
      setError(null)
      const res = await fetch(`/api/student/teacher-annotations?pageId=${encodeURIComponent(pageId)}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }

      const data: TeacherBroadcastData = await res.json()
      setClassAnnotations(data.classAnnotations || [])
      setIndividualFeedback(data.individualFeedback || null)
    } catch (err) {
      console.error('[useTeacherBroadcast] Failed to fetch annotations:', err)
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
      // Check if event is for this page
      if (event.type === 'teacher-annotations-update') {
        if (event.pageId === pageId) {
          // Refetch to get updated class annotations
          fetchAnnotations()
        }
      } else if (event.type === 'teacher-feedback') {
        if (event.pageId === pageId) {
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
