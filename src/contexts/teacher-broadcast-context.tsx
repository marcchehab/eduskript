'use client'

/**
 * TeacherBroadcastContext - Centralized teacher broadcast data
 *
 * PROBLEM SOLVED: Before this context, each component that needed teacher broadcasts
 * (annotation-layer, code-editor, etc.) called useTeacherBroadcast independently,
 * resulting in N duplicate API calls per page where N = number of consumers.
 *
 * SOLUTION: This context fetches teacher broadcasts ONCE per page and provides
 * the data to all consumers via React Context.
 *
 * USAGE:
 * 1. Wrap page content with <TeacherBroadcastProvider pageId="...">
 * 2. Use useTeacherBroadcastContext() in consumer components
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { useExamSession } from '@/contexts/exam-session-context'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

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

export interface TeacherClassCodeHighlights {
  classId: string
  className: string
  editorId: string
  data: unknown
  updatedAt: number
}

export interface TeacherIndividualFeedback {
  data: unknown
  updatedAt: number
  teacherName?: string
}

export interface TeacherIndividualCodeHighlights {
  editorId: string
  data: unknown
  updatedAt: number
}

export interface TeacherBroadcastData {
  classAnnotations: TeacherClassAnnotation[]
  classSnaps: TeacherClassSnaps[]
  classCodeHighlights: TeacherClassCodeHighlights[]
  individualFeedback: TeacherIndividualFeedback | null
  individualSnapFeedback: TeacherIndividualFeedback | null
  individualCodeHighlights: TeacherIndividualCodeHighlights[]
}

interface TeacherBroadcastContextValue extends TeacherBroadcastData {
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const TeacherBroadcastContext = createContext<TeacherBroadcastContextValue | null>(null)

interface TeacherBroadcastProviderProps {
  pageId: string
  children: ReactNode
}

export function TeacherBroadcastProvider({ pageId, children }: TeacherBroadcastProviderProps) {
  const { status } = useSession()
  const examSession = useExamSession()
  const [classAnnotations, setClassAnnotations] = useState<TeacherClassAnnotation[]>([])
  const [classSnaps, setClassSnaps] = useState<TeacherClassSnaps[]>([])
  const [classCodeHighlights, setClassCodeHighlights] = useState<TeacherClassCodeHighlights[]>([])
  const [individualFeedback, setIndividualFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualSnapFeedback, setIndividualSnapFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualCodeHighlights, setIndividualCodeHighlights] = useState<TeacherIndividualCodeHighlights[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Consider authenticated if either NextAuth session OR exam session is active
  const isAuthenticated = status === 'authenticated' || examSession.isInExamSession

  const fetchAnnotations = useCallback(async () => {
    if (!isAuthenticated || !pageId) {
      setIsLoading(false)
      return
    }

    try {
      setError(null)

      // Single timestamp per fetch - prevents duplicate requests
      const res = await fetch(`/api/student/teacher-annotations?pageId=${encodeURIComponent(pageId)}&_t=${Date.now()}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }

      const data: TeacherBroadcastData = await res.json()
      console.log('[TeacherBroadcastContext] Fetched data:', {
        classAnnotationsCount: data.classAnnotations?.length ?? 0,
        classSnapsCount: data.classSnaps?.length ?? 0,
        classCodeHighlightsCount: data.classCodeHighlights?.length ?? 0,
        hasIndividualFeedback: !!data.individualFeedback,
        hasIndividualSnapFeedback: !!data.individualSnapFeedback,
        individualCodeHighlightsCount: data.individualCodeHighlights?.length ?? 0,
      })
      setClassAnnotations(data.classAnnotations || [])
      setClassSnaps(data.classSnaps || [])
      setClassCodeHighlights(data.classCodeHighlights || [])
      setIndividualFeedback(data.individualFeedback || null)
      setIndividualSnapFeedback(data.individualSnapFeedback || null)
      setIndividualCodeHighlights(data.individualCodeHighlights || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch teacher annotations')
    } finally {
      setIsLoading(false)
    }
  }, [pageId, isAuthenticated])

  // Initial fetch
  useEffect(() => {
    fetchAnnotations()
  }, [fetchAnnotations])

  // Subscribe to real-time updates
  useRealtimeEvents(
    ['teacher-annotations-update', 'teacher-feedback'],
    (event) => {
      console.log('[TeacherBroadcastContext] Received SSE event:', event.type, 'pageId:', (event as { pageId?: string }).pageId, 'current pageId:', pageId)
      if ((event.type === 'teacher-annotations-update' || event.type === 'teacher-feedback') && (event as { pageId?: string }).pageId === pageId) {
        console.log('[TeacherBroadcastContext] Event matches page, refetching')
        fetchAnnotations()
      }
    },
    { enabled: isAuthenticated }
  )

  const value: TeacherBroadcastContextValue = {
    classAnnotations,
    classSnaps,
    classCodeHighlights,
    individualFeedback,
    individualSnapFeedback,
    individualCodeHighlights,
    isLoading,
    error,
    refetch: fetchAnnotations,
  }

  return (
    <TeacherBroadcastContext.Provider value={value}>
      {children}
    </TeacherBroadcastContext.Provider>
  )
}

/**
 * Hook to access teacher broadcast data from context
 *
 * Returns null if used outside of TeacherBroadcastProvider
 * (e.g., for teachers or non-student views)
 */
export function useTeacherBroadcastContext(): TeacherBroadcastContextValue | null {
  return useContext(TeacherBroadcastContext)
}

/**
 * Hook that returns teacher broadcast data or empty defaults
 *
 * Use this when you always need a valid object (no null checks)
 */
export function useTeacherBroadcastContextSafe(): TeacherBroadcastContextValue {
  const context = useContext(TeacherBroadcastContext)
  if (!context) {
    return {
      classAnnotations: [],
      classSnaps: [],
      classCodeHighlights: [],
      individualFeedback: null,
      individualSnapFeedback: null,
      individualCodeHighlights: [],
      isLoading: false,
      error: null,
      refetch: async () => {},
    }
  }
  return context
}
