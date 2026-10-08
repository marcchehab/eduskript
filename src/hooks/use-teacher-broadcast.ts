'use client'

/**
 * Hook for students to receive teacher annotations
 *
 * IMPORTANT: This hook now uses TeacherBroadcastContext when available.
 * If wrapped in TeacherBroadcastProvider, all calls share a single data source.
 * If not wrapped, it falls back to direct API calls (legacy behavior).
 *
 * RECOMMENDED: Wrap pages with TeacherBroadcastProvider to deduplicate requests.
 *
 * USAGE: Called by student-facing components (annotation-layer, code-editor)
 * to receive teacher content. The hook is intentionally "dumb" - it fetches
 * everything for the page and lets consumers filter by their needs.
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useExamSession } from '@/contexts/exam-session-context'
import { useTeacherBroadcastContext } from '@/contexts/teacher-broadcast-context'
import { useRealtimeEvents } from './use-realtime-events'
import { useCurrentSite } from '@/contexts/current-site-context'

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

export interface TeacherClassSpacers {
  classId: string
  className: string
  data: unknown
  updatedAt: number
}

/**
 * Code highlights broadcast for a class
 * editorId identifies which code editor on the page this belongs to
 * (extracted from adapter name: code-highlights-{editorId})
 */
export interface TeacherClassCodeHighlights {
  classId: string
  className: string
  editorId: string
  data: unknown  // Actually BroadcastHighlightsData but typed as unknown for flexibility
  updatedAt: number
}

export interface TeacherIndividualFeedback {
  data: unknown
  updatedAt: number
  teacherName?: string
}

/**
 * Code highlights targeted at a specific student
 * Structure mirrors TeacherClassCodeHighlights but without class info
 */
export interface TeacherIndividualCodeHighlights {
  editorId: string
  data: unknown  // Actually BroadcastHighlightsData but typed as unknown for flexibility
  updatedAt: number
}

export interface TeacherClassStickyNotes {
  classId: string
  className: string
  data: unknown
  updatedAt: number
}

export interface TeacherBroadcastData {
  classAnnotations: TeacherClassAnnotation[]
  classSnaps: TeacherClassSnaps[]
  classSpacers: TeacherClassSpacers[]
  classCodeHighlights: TeacherClassCodeHighlights[]
  classStickyNotes: TeacherClassStickyNotes[]
  individualFeedback: TeacherIndividualFeedback | null
  individualSnapFeedback: TeacherIndividualFeedback | null
  individualSpacerFeedback: TeacherIndividualFeedback | null
  individualCodeHighlights: TeacherIndividualCodeHighlights[]
  individualStickyNotes: TeacherIndividualFeedback | null
}

interface TeacherBroadcastResult {
  classAnnotations: TeacherClassAnnotation[]
  classSnaps: TeacherClassSnaps[]
  classSpacers: TeacherClassSpacers[]
  classCodeHighlights: TeacherClassCodeHighlights[]
  classStickyNotes: TeacherClassStickyNotes[]
  individualFeedback: TeacherIndividualFeedback | null
  individualSnapFeedback: TeacherIndividualFeedback | null
  individualSpacerFeedback: TeacherIndividualFeedback | null
  individualCodeHighlights: TeacherIndividualCodeHighlights[]
  individualStickyNotes: TeacherIndividualFeedback | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Hook to receive teacher annotations for a specific page
 *
 * Uses TeacherBroadcastContext when available (recommended).
 * Falls back to direct API calls when context is not present.
 *
 * @param pageId - The page ID to fetch annotations for
 * @returns Object with teacher annotations and loading state
 */
export function useTeacherBroadcast(pageId: string): TeacherBroadcastResult {
  // Try to use context first (deduplicates requests)
  const contextData = useTeacherBroadcastContext()

  // Direct fetch state (used when context not available)
  const { status } = useSession()
  const examSession = useExamSession()
  const [classAnnotations, setClassAnnotations] = useState<TeacherClassAnnotation[]>([])
  const [classSnaps, setClassSnaps] = useState<TeacherClassSnaps[]>([])
  const [classSpacers, setClassSpacers] = useState<TeacherClassSpacers[]>([])
  const [classCodeHighlights, setClassCodeHighlights] = useState<TeacherClassCodeHighlights[]>([])
  const [classStickyNotes, setClassStickyNotes] = useState<TeacherClassStickyNotes[]>([])
  const [individualFeedback, setIndividualFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualSnapFeedback, setIndividualSnapFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualSpacerFeedback, setIndividualSpacerFeedback] = useState<TeacherIndividualFeedback | null>(null)
  const [individualCodeHighlights, setIndividualCodeHighlights] = useState<TeacherIndividualCodeHighlights[]>([])
  const [individualStickyNotes, setIndividualStickyNotes] = useState<TeacherIndividualFeedback | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track if context is being used
  const useContext = !!contextData

  // Consider authenticated if either NextAuth session OR exam session is active
  const isAuthenticated = status === 'authenticated' || examSession.isInExamSession
  // Site scoping: broadcasts are per site (src/lib/site-access.ts).
  const { siteId } = useCurrentSite()

  // Fetch teacher annotations from API (only when context not available)
  const fetchAnnotations = useCallback(async () => {
    if (useContext || !isAuthenticated || !pageId || !siteId) {
      setIsLoading(false)
      return
    }

    try {
      setError(null)

      const res = await fetch(`/api/student/teacher-annotations?pageId=${encodeURIComponent(pageId)}&siteId=${encodeURIComponent(siteId)}&_t=${Date.now()}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`)
      }

      const data: TeacherBroadcastData = await res.json()
      console.log('[useTeacherBroadcast] Fetched data (fallback):', {
        classAnnotationsCount: data.classAnnotations?.length ?? 0,
        classSnapsCount: data.classSnaps?.length ?? 0,
        classSpacersCount: data.classSpacers?.length ?? 0,
        classCodeHighlightsCount: data.classCodeHighlights?.length ?? 0,
        classStickyNotesCount: data.classStickyNotes?.length ?? 0,
        hasIndividualFeedback: !!data.individualFeedback,
        hasIndividualSnapFeedback: !!data.individualSnapFeedback,
        hasIndividualSpacerFeedback: !!data.individualSpacerFeedback,
        individualCodeHighlightsCount: data.individualCodeHighlights?.length ?? 0,
        hasIndividualStickyNotes: !!data.individualStickyNotes,
        individualFeedbackTeacherName: data.individualFeedback?.teacherName,
      })
      setClassAnnotations(data.classAnnotations || [])
      setClassSnaps(data.classSnaps || [])
      setClassSpacers(data.classSpacers || [])
      setClassCodeHighlights(data.classCodeHighlights || [])
      setClassStickyNotes(data.classStickyNotes || [])
      setIndividualFeedback(data.individualFeedback || null)
      setIndividualSnapFeedback(data.individualSnapFeedback || null)
      setIndividualSpacerFeedback(data.individualSpacerFeedback || null)
      setIndividualCodeHighlights(data.individualCodeHighlights || [])
      setIndividualStickyNotes(data.individualStickyNotes || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch teacher annotations')
    } finally {
      setIsLoading(false)
    }
  }, [pageId, siteId, isAuthenticated, useContext])

  // Initial fetch (only when context not available)
  useEffect(() => {
    if (!useContext) {
      fetchAnnotations()
    }
  }, [fetchAnnotations, useContext])

  // Subscribe to real-time updates (only when context not available)
  // When context IS available, the context handles SSE subscription
  useRealtimeEvents(
    ['teacher-annotations-update', 'teacher-feedback'],
    (event) => {
      if (useContext) return // Context handles this
      const evSite = (event as { siteId?: string }).siteId
      if (evSite && evSite !== siteId) return // another site's broadcast
      console.log('[useTeacherBroadcast] Received SSE event (fallback):', event.type, 'pageId:', (event as { pageId?: string }).pageId, 'current pageId:', pageId)
      if (event.type === 'teacher-annotations-update') {
        if ((event as { pageId?: string }).pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching class broadcasts')
          fetchAnnotations()
        }
      } else if (event.type === 'teacher-feedback') {
        if ((event as { pageId?: string }).pageId === pageId) {
          console.log('[useTeacherBroadcast] Event matches page, refetching individual feedback')
          fetchAnnotations()
        }
      }
    },
    { enabled: isAuthenticated && !useContext }
  )

  // If context is available, return context data
  if (contextData) {
    return contextData
  }

  // Fallback: return direct fetch data
  return {
    classAnnotations,
    classSnaps,
    classSpacers,
    classCodeHighlights,
    classStickyNotes,
    individualFeedback,
    individualSnapFeedback,
    individualSpacerFeedback,
    individualCodeHighlights,
    individualStickyNotes,
    isLoading,
    error,
    refetch: fetchAnnotations,
  }
}
