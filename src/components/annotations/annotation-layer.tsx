/**
 * Annotation Layer - Multi-User Canvas Overlay System
 *
 * This is the most complex component in Eduskript (~2500 lines). It manages
 * a layered annotation system where teachers and students can draw on content.
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Page Content (markdown)                                    │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Reference Layers (read-only, portaled into paper)          │
 * │  ├─ Public annotations (page author's broadcasts)           │
 * │  ├─ Class broadcasts (teacher → all students)               │
 * │  ├─ Individual feedback (teacher → specific student)        │
 * │  └─ Personal reference (teacher's own when broadcasting)    │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Active Canvas (editable, user's current drawing target)    │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Snap Overlays (positioned screenshots)                     │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## View Modes (Teachers)
 *
 * - `my-view`: Personal annotations (default)
 * - `class-broadcast`: Draw annotations visible to entire class
 * - `student-view`: Give individual feedback to specific student
 * - `page-broadcast`: Public annotations visible to all visitors
 *
 * ## Cross-Device Alignment
 *
 * Annotations are stored with section IDs and Y-offsets. When displayed on
 * a different device, strokes are repositioned based on current heading
 * positions via `repositionStrokes()`. This handles responsive layouts.
 *
 * ## Known Limitations & Technical Debt
 *
 * 1. **Component size**: At ~2500 lines, this should ideally be split into
 *    smaller modules (layer management, toolbar integration, sync logic).
 *    The current monolithic structure makes testing and maintenance harder.
 *
 * 2. **State explosion**: Many useState/useRef pairs track similar things.
 *    A state machine or reducer pattern would be cleaner but would require
 *    significant refactoring.
 *
 * 3. **Ref gymnastics**: We use refs (canvasDataRef, pageVersionRef, etc.)
 *    alongside state to avoid stale closures in callbacks. This works but
 *    is error-prone and requires careful synchronization.
 *
 * 4. **Multiple data hooks**: We instantiate several useSyncedUserData hooks
 *    for different targets (personal, class, student, page). This works but
 *    creates complexity and potential race conditions when switching modes.
 *
 * 5. **Fallback refs pattern**: We store canvas data in refs when switching
 *    modes (studentFeedbackCanvasRef, classBroadcastCanvasRef) to provide
 *    immediate UI feedback before the sync hook catches up. This is a
 *    workaround for async data loading latency.
 *
 * 6. **Portal complexity**: Reference layers are portaled into the paper
 *    element for correct stacking. This works but makes the component tree
 *    harder to reason about.
 *
 * 7. **No undo/redo**: The canvas supports clear-all but not undo. Adding
 *    undo would require storing stroke history, which we don't currently do.
 *
 * ## Performance Notes
 *
 * - Reference layers use CSS opacity transitions instead of per-stroke
 *   animation to avoid React re-renders during fade-in.
 * - Stroke telemetry is sampled (every 10th stroke) to reduce data volume.
 * - Layer visibility uses localStorage to persist user preferences.
 *
 * @see simple-canvas.tsx - The actual HTML canvas drawing implementation
 * @see annotation-toolbar.tsx - UI controls for drawing modes
 * @see reposition-strokes.ts - Cross-device stroke alignment algorithm
 * @see src/lib/userdata/provider.tsx - Data sync infrastructure
 */

'use client'

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, User, Users, MessageSquare, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationSvgLayer } from './annotation-svg-layer'
import { SectionAnchoredStrokes } from './section-anchored-strokes'
import { AnnotationToolbar, formatStudentLabel, type AnnotationMode } from './annotation-toolbar'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { useSyncedUserData, useUserDataContext, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import type { AnnotationData, StrokeTelemetry, TelemetryData } from '@/lib/userdata/types'
import type { SnapsData, SpacersData } from '@/lib/userdata/adapters'
import type { Spacer, SpacerPattern } from '@/types/spacer'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { getStrokeAvg } from '@/lib/annotations/stroke-grouping'
import { repositionSnaps, determineSectionFromY } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useStickyNotesContext } from '@/contexts/sticky-notes-context'
import { LayerVisibilityProvider } from '@/contexts/layer-visibility-context'
import { HeadingPositionsProvider } from '@/contexts/heading-positions-context'
import { ZoomProvider } from '@/contexts/zoom-context'
import { useTeacherBroadcast } from '@/hooks/use-teacher-broadcast'
import { useStudentWork } from '@/hooks/use-student-work'
import { parseStrokes, type AnimatedStroke } from '@/hooks/use-stroke-animation'
import { useSession } from 'next-auth/react'
import type { Snap } from '@/types/snap'
import { PasteSnapHandler } from './paste-snap-handler'
import { SnapsDisplay, type StudentWorkSnap } from './snaps-display'
import { LayerBadges } from './layer-badges'
import { SpacersDisplay } from './spacers-display'
import { createLogger } from '@/lib/logger'

const log = createLogger('annotations:layer')

import type { PublicAnnotation, PublicSnap } from '@/components/public/annotation-wrapper'

/** Pre-fetched public annotation for rendering */
interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
  /** Public annotations fetched from server (for all visitors) */
  publicAnnotations?: PublicAnnotation[]
  /** Public snaps fetched from server (for all visitors) */
  publicSnaps?: PublicSnap[]
  /** Whether current user can create public annotations (checked server-side) */
  isPageAuthor?: boolean
  /** Whether user is a student in an exam session (for SEB mode where NextAuth session isn't available) */
  isExamStudent?: boolean
}

export function AnnotationLayer({ pageId, content, children, publicAnnotations = [], publicSnaps = [], isPageAuthor: isPageAuthorProp = false, isExamStudent = false }: AnnotationLayerProps) {
  const { sidebarWidth, viewportWidth, viewportHeight } = useLayout()
  const { data: session } = useSession()
  const { selectedClass, setSelectedClass, selectedStudent, setSelectedStudent, broadcastToPage, setBroadcastToPage, viewMode, isTeacher } = useTeacherClass()
  const { setAnnotationVersionMismatch, setOnClearAnnotations } = useUserDataContext()

  // Client-side check for page author permission (ISR pages can't compute this server-side)
  const [isPageAuthor, setIsPageAuthor] = useState(isPageAuthorProp)

  // State for classes and students lists (for toolbar broadcast controls)
  const [teacherClasses, setTeacherClasses] = useState<Array<{ id: string; name: string; hasAnnotationsOnPage?: boolean }>>([])
  const [classStudents, setClassStudents] = useState<Array<{ id: string; displayName: string; pseudonym?: string; revealedEmail?: string | null; hasAnnotationsOnPage?: boolean }>>([])

  // Track last selected student for quick-access and data loading when in class-broadcast mode
  const [lastSelectedStudent, setLastSelectedStudent] = useState<{ id: string; displayName: string; pseudonym?: string; revealedEmail?: string | null } | null>(null)
  // Store student feedback canvas data when switching from student-view to class-broadcast
  // This is used as a fallback until the studentFeedbackData hook catches up
  const studentFeedbackCanvasRef = useRef<string>('')
  // Store class broadcast canvas data when switching from class-broadcast to student-view
  // This provides a fallback when the classBroadcastData hook hasn't loaded yet
  const classBroadcastCanvasRef = useRef<string>('')
  // Update lastSelectedStudent when a student is selected
  useEffect(() => {
    if (selectedStudent) {
      setLastSelectedStudent(selectedStudent)
    }
  }, [selectedStudent])

  // Fetch teacher's classes (with annotation status for current page)
  useEffect(() => {
    if (!isTeacher || !pageId) return

    const fetchClasses = async () => {
      try {
        const res = await fetch(`/api/classes?pageId=${encodeURIComponent(pageId)}`)
        if (res.ok) {
          const data = await res.json()
          setTeacherClasses(data.classes?.map((c: { id: string; name: string; hasAnnotationsOnPage?: boolean }) => ({
            id: c.id,
            name: c.name,
            hasAnnotationsOnPage: c.hasAnnotationsOnPage
          })) || [])
        }
      } catch (e) {
        console.error('Failed to fetch classes:', e)
      }
    }

    fetchClasses()
  }, [isTeacher, pageId])

  // Fetch page author permission client-side (ISR pages can't compute this server-side)
  useEffect(() => {
    // Skip if already true from prop (non-ISR page) or no session
    if (isPageAuthorProp || !session?.user) return

    const checkPermission = async () => {
      try {
        const res = await fetch(`/api/pages/${encodeURIComponent(pageId)}/author-check`)
        if (res.ok) {
          const data = await res.json()
          if (data.isPageAuthor) {
            setIsPageAuthor(true)
          }
        }
      } catch (e) {
        console.error('Failed to check page author permission:', e)
      }
    }

    checkPermission()
  }, [pageId, session?.user, isPageAuthorProp])

  // Fetch students when a class is selected (with annotation status for current page)
  useEffect(() => {
    if (!isTeacher || !selectedClass || !pageId) {
      setClassStudents([])
      return
    }

    const fetchStudents = async () => {
      try {
        // Resolve student identities from two consent-gated sources, fetched in parallel:
        // 1) Local IndexedDB roster mapping (primary in practice) — populated by the
        //    dashboard's paste-roster flow, which only stores entries the server
        //    matched against consenting students via /api/classes/[id]/resolve-emails.
        //    OAuth-only students (no User.email column) live exclusively here.
        // 2) Server `revealedEmail` — set when identityConsent is true AND the student
        //    has a populated email column. Rare in production, mostly seed/dev data.
        const [res, reverseMap] = await Promise.all([
          fetch(`/api/classes/${selectedClass.id}/students?pageId=${encodeURIComponent(pageId)}`),
          getReverseMappingsForClass(selectedClass.id).catch(() => ({} as Record<string, string>)),
        ])
        if (res.ok) {
          const data = await res.json()
          setClassStudents(data.students?.map((s: { id: string; displayName: string; pseudonym?: string; revealedEmail?: string | null; hasAnnotationsOnPage?: boolean }) => ({
            id: s.id,
            displayName: s.displayName,
            pseudonym: s.pseudonym,
            revealedEmail: (s.pseudonym ? reverseMap[s.pseudonym] : null) ?? s.revealedEmail ?? null,
            hasAnnotationsOnPage: s.hasAnnotationsOnPage
          })) || [])
        }
      } catch (e) {
        console.error('Failed to fetch students:', e)
      }
    }

    fetchStudents()
  }, [isTeacher, selectedClass, pageId])

  // Compute targeting options based on teacher selection
  // - 'my-view': No targeting (personal annotations)
  // - 'class-broadcast': targetType='class', targetId=classId
  // - 'student-view': targetType='student', targetId=studentId
  // - 'page-broadcast': targetType='page', targetId=pageId (public annotations)
  const syncOptions: SyncedUserDataOptions = useMemo(() => {
    // Page authors can broadcast to all visitors
    if (viewMode === 'page-broadcast') {
      const opts = { targetType: 'page' as const, targetId: pageId }
      log('syncOptions computed for page-broadcast:', opts)
      return opts
    }

    if (!isTeacher) return {}

    if (viewMode === 'class-broadcast' && selectedClass) {
      const opts = { targetType: 'class' as const, targetId: selectedClass.id }
      log('syncOptions computed for class-broadcast:', opts)
      return opts
    }
    if (viewMode === 'student-view' && selectedStudent) {
      const opts = { targetType: 'student' as const, targetId: selectedStudent.id }
      log('syncOptions computed for student-view:', opts)
      return opts
    }
    log('syncOptions computed for my-view: {}')
    return {} // my-view: personal annotations
  }, [isTeacher, viewMode, selectedClass, selectedStudent, pageId])

  // Create a stable key for targeting to detect changes
  const targetingKey = `${syncOptions.targetType ?? ''}-${syncOptions.targetId ?? ''}`

  // Use synced user data service for annotations (with targeting for teachers)
  const { data: annotationData, updateData: updateAnnotationData, isLoading: annotationLoading } = useSyncedUserData<AnnotationData>(
    pageId,
    'annotations',
    null,
    syncOptions
  )

  // Debug: log when annotationData (active layer) changes
  useEffect(() => {
    log('annotationData (active layer) changed:', {
      hasData: !!annotationData?.canvasData,
      dataLength: annotationData?.canvasData?.length ?? 0,
      syncOptions,
      viewMode
    })
  }, [annotationData, syncOptions, viewMode])

  // Use synced user data service for snaps
  // IMPORTANT: initialData must be a stable reference, not an inline object literal
  // Teachers: snaps are targeted to class/student based on syncOptions (same as annotations)
  const emptySnapsData = useMemo(() => ({ snaps: [] } as SnapsData), [])
  const { data: snapsData, updateData: updateSnapsData, isLoading: snapsLoading } = useSyncedUserData<SnapsData>(
    pageId,
    'snaps',
    emptySnapsData,
    syncOptions
  )

  // Use synced user data service for spacers
  // Spacers follow the same targeting as annotations/snaps for broadcast support
  const emptySpacersData = useMemo(() => ({ spacers: [] } as SpacersData), [])
  const { data: spacersData, updateData: updateSpacersData } = useSyncedUserData<SpacersData>(
    pageId,
    'spacers',
    emptySpacersData,
    syncOptions
  )

  // For students: fetch teacher broadcasts (annotations + snaps)
  // isExamStudent handles the SEB exam case where NextAuth session isn't available
  const isStudent = session?.user?.accountType === 'student' || isExamStudent
  const {
    classAnnotations: teacherClassAnnotations,
    classSnaps: teacherClassSnaps,
    classSpacers: teacherClassSpacers,
    individualFeedback: teacherIndividualFeedback,
    individualSnapFeedback: teacherIndividualSnapFeedback,
    individualSpacerFeedback: teacherIndividualSpacerFeedback,
    isLoading: teacherAnnotationsLoading,
    refetch: refetchTeacherAnnotations,
  } = useTeacherBroadcast(isStudent ? pageId : '')

  // Sticky notes: placement mode and count come from StickyNotesContext (provided above us in annotation-wrapper)
  const { placementMode: stickyNotePlacementMode, setPlacementMode: setStickyNotePlacementMode, noteCount: stickyNoteCount, clearStickyNotes } = useStickyNotesContext()

  // For teachers: also load personal annotations when broadcasting to class/student
  // This allows them to see their personal annotations as a reference layer
  const shouldLoadPersonalAsReference = isTeacher && viewMode !== 'my-view'
  const { data: personalAnnotationData, updateData: updatePersonalAnnotationData } = useSyncedUserData<AnnotationData>(
    shouldLoadPersonalAsReference ? pageId : '',
    'annotations',
    null,
    {} // No targeting = personal annotations
  )
  // Personal spacers hook (needed when broadcasting, so we can clear personal spacers independently)
  const { updateData: updatePersonalSpacersData } = useSyncedUserData<SpacersData>(
    shouldLoadPersonalAsReference ? pageId : '',
    'spacers',
    emptySpacersData,
    {} // No targeting = personal spacers
  )
  // Personal snaps hook (needed when broadcasting, so we can clear personal snaps independently)
  const { updateData: updatePersonalSnapsData } = useSyncedUserData<SnapsData>(
    shouldLoadPersonalAsReference ? pageId : '',
    'snaps',
    emptySnapsData,
    {} // No targeting = personal snaps
  )

  // Layer visibility state
  // Keys: 'personal', 'class', 'individual' (for students), 'class-{classId}' (for class broadcasts)
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({})
  const layerVisibilityInitializedRef = useRef(false)

  // Load layer visibility preferences from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !layerVisibilityInitializedRef.current) {
      layerVisibilityInitializedRef.current = true
      const stored = localStorage.getItem('annotation-layer-visibility')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          if (typeof parsed === 'object') {
            setLayerVisibility(parsed)
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [])

  // Auto-hide personal annotations when teacher selects a class (but only on first selection)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (isTeacher && prevViewModeRef.current === 'my-view' && viewMode !== 'my-view') {
      // Teacher just switched from personal to class/student/page-broadcast view
      // Auto-hide personal reference layer (controls button state in broadcast mode)
      setLayerVisibility(prev => {
        const next = { ...prev, personal: false }
        if (typeof window !== 'undefined') {
          localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
        }
        return next
      })
    }
    // Auto-hide student feedback when switching from student-view to class-broadcast
    if (isTeacher && prevViewModeRef.current === 'student-view' && viewMode === 'class-broadcast') {
      // Save current canvas data before it gets cleared (for reference layer fallback)
      studentFeedbackCanvasRef.current = canvasDataRef.current

      // Teacher just switched from individual student to entire class
      // Auto-hide student feedback layer (unless manually toggled before)
      setLayerVisibility(prev => {
        const next = { ...prev, 'student-feedback': false }
        if (typeof window !== 'undefined') {
          localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
        }
        return next
      })
    }
    // Save class broadcast canvas data when switching from class-broadcast to student-view
    // This provides a fallback for the reference layer until classBroadcastData hook loads
    if (isTeacher && prevViewModeRef.current === 'class-broadcast' && viewMode === 'student-view') {
      classBroadcastCanvasRef.current = canvasDataRef.current
      log('Stored class broadcast canvas for reference:', canvasDataRef.current?.length ?? 0, 'chars')
    }
    // Sync page-broadcast reference hook when switching away from page-broadcast
    // The main useSyncedUserData hook saves to IndexedDB/server, but pageBroadcastData
    // (a separate hook instance) doesn't know about it — update its React state directly
    if (isTeacher && prevViewModeRef.current === 'page-broadcast' && viewMode !== 'page-broadcast') {
      updatePageBroadcastDataRef.current?.()
    }
    prevViewModeRef.current = viewMode
  }, [isTeacher, viewMode])

  // Helper to get default visibility for a layer
  const getDefaultVisibility = useCallback((layerId: string) => {
    // Personal hidden by default when teacher is broadcasting
    if (layerId === 'personal' && isTeacher && viewMode !== 'my-view') {
      return false
    }
    // Student feedback and student work hidden by default when in class-broadcast mode
    // (these two layers are treated as one unified layer from teacher's perspective)
    if ((layerId === 'student-feedback' || layerId === 'student-work') && isTeacher && viewMode === 'class-broadcast') {
      return false
    }
    return true // All other layers visible by default
  }, [isTeacher, viewMode])

  // Toggle a layer's visibility
  // IMPORTANT: Must account for default visibility when layer hasn't been explicitly set
  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayerVisibility(prev => {
      // Get current visibility: explicit value or default
      const currentVisible = layerId in prev ? prev[layerId] : getDefaultVisibility(layerId)
      const next = { ...prev, [layerId]: !currentVisible }
      if (typeof window !== 'undefined') {
        localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
      }
      return next
    })
  }, [getDefaultVisibility])

  // Get visibility for a layer (default: true for most, false for personal/student-feedback in certain modes)
  const isLayerVisible = useCallback((layerId: string) => {
    if (layerId in layerVisibility) {
      return layerVisibility[layerId]
    }
    return getDefaultVisibility(layerId)
  }, [layerVisibility, getDefaultVisibility])

  // Expose layer visibility to child components (sticky notes, highlights, etc.)
  const layerVisibilityContextValue = useMemo(() => ({ isLayerVisible }), [isLayerVisible])

  // "My annotations" visibility - controls personal annotations (person icon)
  // When in broadcast mode, this controls the 'personal' reference layer
  // When in personal mode, this controls the 'my-annotations' main layer
  const personalLayerKey = (isTeacher && viewMode !== 'my-view') ? 'personal' : 'my-annotations'
  const myAnnotationsVisible = isLayerVisible(personalLayerKey)
  const toggleMyAnnotationsVisibility = useCallback(() => {
    toggleLayerVisibility(personalLayerKey)
  }, [toggleLayerVisibility, personalLayerKey])

  // Active layer key - determines which layer the canvas is drawing to
  const activeLayerKey = useMemo(() => {
    if (viewMode === 'page-broadcast') return 'page-broadcast'
    if (isTeacher && viewMode === 'class-broadcast') return 'class-broadcast'
    if (isTeacher && viewMode === 'student-view') return 'student-feedback'
    return 'my-annotations'
  }, [isTeacher, viewMode])

  // Whether my annotations is the active drawing layer
  const myAnnotationsActive = activeLayerKey === 'my-annotations'

  // Active layer visibility - controls canvas opacity based on what we're drawing to
  const activeLayerVisible = isLayerVisible(activeLayerKey)

  // Ensure active layer is visible (called when user draws)
  const ensureActiveLayerVisible = useCallback(() => {
    if (!isLayerVisible(activeLayerKey)) {
      setLayerVisibility(prev => {
        const next = { ...prev, [activeLayerKey]: true }
        if (typeof window !== 'undefined') {
          localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
        }
        return next
      })
    }
  }, [activeLayerKey, isLayerVisible])

  // Class broadcast visibility (for teachers)
  const classBroadcastVisible = isLayerVisible('class-broadcast')
  const toggleClassBroadcastVisibility = useCallback(() => {
    log('toggleClassBroadcastVisibility called, current:', classBroadcastVisible)
    toggleLayerVisibility('class-broadcast')
  }, [toggleLayerVisibility, classBroadcastVisible])

  // Student feedback visibility (for teachers)
  // This controls BOTH student-feedback (teacher's feedback to student) AND student-work (student's own annotations)
  // They're shown as a unified layer from the teacher's perspective
  const studentFeedbackVisible = isLayerVisible('student-feedback')
  const toggleStudentFeedbackVisibility = useCallback(() => {
    log('toggleStudentFeedbackVisibility called, current:', studentFeedbackVisible)
    // Toggle both layers together - they appear as one unified layer to the teacher
    setLayerVisibility(prev => {
      const currentVisible = 'student-feedback' in prev ? prev['student-feedback'] : true
      const newVisible = !currentVisible
      const next = {
        ...prev,
        'student-feedback': newVisible,
        'student-work': newVisible,
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
      }
      return next
    })
  }, [studentFeedbackVisible])

  // Page broadcast visibility (for page authors)
  const pageBroadcastVisible = isLayerVisible('page-broadcast')
  const togglePageBroadcastVisibility = useCallback(() => {
    log('togglePageBroadcastVisibility called, current:', pageBroadcastVisible)
    toggleLayerVisibility('page-broadcast')
  }, [toggleLayerVisibility, pageBroadcastVisible])

  // Check which layers have content
  const hasPersonalContent = shouldLoadPersonalAsReference &&
    personalAnnotationData?.canvasData &&
    personalAnnotationData.canvasData.length > 0 &&
    personalAnnotationData.canvasData !== '[]'

  const hasClassContent = teacherClassAnnotations.length > 0
  const hasIndividualContent = teacherIndividualFeedback !== null
  const hasClassSnapsContent = teacherClassSnaps.length > 0
  const hasIndividualSnapsContent = teacherIndividualSnapFeedback !== null

  const hasPublicContent = publicAnnotations.length > 0 || publicSnaps.length > 0

  // Use synced user data service for telemetry (lightweight, sampled)
  const emptyTelemetryData = useMemo(() => ({ samples: [], totalStrokeCount: 0, sessionCount: 0, firstSampleAt: 0 } as TelemetryData), [])
  const { data: telemetryData, updateData: updateTelemetryData } = useSyncedUserData<TelemetryData>(
    pageId,
    'annotation-telemetry',
    emptyTelemetryData
  )
  const telemetryBufferRef = useRef<StrokeTelemetry[]>([])
  const TELEMETRY_BATCH_SIZE = 20
  const TELEMETRY_SAMPLE_RATE = 10 // Must match simple-canvas.tsx

  // Handle telemetry from SimpleCanvas (called every 10th stroke)
  const handleTelemetry = useCallback((sample: StrokeTelemetry) => {
    telemetryBufferRef.current.push(sample)

    // Persist when batch is full (20 samples = 200 strokes)
    if (telemetryBufferRef.current.length >= TELEMETRY_BATCH_SIZE) {
      const newData: TelemetryData = {
        samples: [...(telemetryData?.samples ?? []), ...telemetryBufferRef.current].slice(-200), // Keep last 200 samples
        totalStrokeCount: (telemetryData?.totalStrokeCount ?? 0) + (TELEMETRY_BATCH_SIZE * TELEMETRY_SAMPLE_RATE),
        sessionCount: telemetryData?.sessionCount ?? 1,
        firstSampleAt: telemetryData?.firstSampleAt || Date.now()
      }
      updateTelemetryData(newData)
      telemetryBufferRef.current = []
    }
  }, [telemetryData, updateTelemetryData])

  // Delete function - update with empty/null data
  // Use immediate: true to ensure clear operation syncs to server right away
  // (especially important for teacher broadcasts so students see the clear)
  const deleteAnnotationData = useCallback(async () => {
    await updateAnnotationData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
  }, [updateAnnotationData])

  // Delete personal annotations only (for teachers when broadcasting)
  // This is used by the "My annotations" trash button which should only clear personal, not broadcast
  const deletePersonalAnnotationData = useCallback(async () => {
    if (shouldLoadPersonalAsReference && updatePersonalAnnotationData) {
      await updatePersonalAnnotationData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
    } else {
      // If not in broadcast mode, personal annotations = current annotations
      await updateAnnotationData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
    }
  }, [shouldLoadPersonalAsReference, updatePersonalAnnotationData, updateAnnotationData])

  // Synced data hooks for specific broadcast targets (used for targeted deletions)
  // These allow deleting class broadcast or student feedback regardless of current view
  const classBroadcastSyncOptions: SyncedUserDataOptions = useMemo(() => {
    if (!isTeacher || !selectedClass) return {}
    return { targetType: 'class', targetId: selectedClass.id }
  }, [isTeacher, selectedClass])

  // Use selectedStudent if available, otherwise fall back to lastSelectedStudent for data loading
  const studentForFeedback = selectedStudent || lastSelectedStudent
  // Use ID for stable reference in sync options (avoids object reference changes)
  const studentForFeedbackId = selectedStudent?.id || lastSelectedStudent?.id

  const studentFeedbackSyncOptions: SyncedUserDataOptions = useMemo(() => {
    if (!isTeacher || !studentForFeedbackId) return {}
    return { targetType: 'student', targetId: studentForFeedbackId }
  }, [isTeacher, studentForFeedbackId])

  // Get data and update functions for class broadcast and student feedback (for targeted deletions)
  // Only load when we have valid targeting to avoid warning about empty pageId
  const shouldLoadClassBroadcast = isTeacher && !!selectedClass
  // Load student feedback for selected student OR last selected (for reference layer in class-broadcast mode)
  const shouldLoadStudentFeedback = isTeacher && !!studentForFeedbackId

  const { data: classBroadcastData, updateData: updateClassBroadcastData } = useSyncedUserData<AnnotationData>(
    shouldLoadClassBroadcast ? pageId : '__skip__', // Use placeholder to skip loading
    'annotations',
    null,
    classBroadcastSyncOptions
  )

  // Debug: log when classBroadcastData changes
  useEffect(() => {
    log('classBroadcastData changed:', {
      hasData: !!classBroadcastData?.canvasData,
      dataLength: classBroadcastData?.canvasData?.length ?? 0,
      syncOptions: classBroadcastSyncOptions
    })
  }, [classBroadcastData, classBroadcastSyncOptions])

  // Track classBroadcastData.canvasData for triggering recalculation later
  const classBroadcastCanvasDataRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    classBroadcastCanvasDataRef.current = classBroadcastData?.canvasData
  }, [classBroadcastData?.canvasData])

  const { data: studentFeedbackData, updateData: updateStudentFeedbackData } = useSyncedUserData<AnnotationData>(
    shouldLoadStudentFeedback ? pageId : '__skip__', // Use placeholder to skip loading
    'annotations',
    null,
    studentFeedbackSyncOptions
  )

  // Debug: log when studentFeedbackData changes
  useEffect(() => {
    log('studentFeedbackData changed:', {
      hasData: !!studentFeedbackData?.canvasData,
      dataLength: studentFeedbackData?.canvasData?.length ?? 0,
      syncOptions: studentFeedbackSyncOptions
    })
  }, [studentFeedbackData, studentFeedbackSyncOptions])

  // Load the student's OWN annotations and snaps (their personal work, not teacher feedback TO them)
  // This allows teachers to see what the student has drawn on the page
  const { data: studentWorkData, isLoading: studentWorkLoading } = useStudentWork({
    classId: isTeacher && studentForFeedback ? selectedClass?.id ?? null : null,
    studentId: isTeacher && studentForFeedback ? studentForFeedback.id : null,
    pageId,
    adapters: ['annotations', 'snaps']
  })

  // Debug: log when studentWorkData changes
  useEffect(() => {
    if (isTeacher && studentForFeedback) {
      log('studentWorkData changed:', {
        hasData: !!studentWorkData?.annotations?.data,
        canvasDataLength: (studentWorkData?.annotations?.data as { canvasData?: string } | undefined)?.canvasData?.length ?? 0,
        studentId: studentForFeedback.id,
        isLoading: studentWorkLoading
      })
    }
  }, [studentWorkData, studentForFeedback, isTeacher, studentWorkLoading])

  // Sync options for page-broadcast (public annotations)
  const pageBroadcastSyncOptions: SyncedUserDataOptions = useMemo(() => {
    return { targetType: 'page', targetId: pageId }
  }, [pageId])

  // Load page-broadcast data for reference layer when not actively editing.
  // This is the live-syncable copy; non-authors render the SSR-passed
  // `publicAnnotations` prop instead (see line ~3331), so they don't need
  // this hook to fire — gating with the empty-pageId sentinel saves a
  // /api/user-data/annotations/{pageId}?targetType=page round-trip on every
  // anonymous public-page visit. Authors get it once `isPageAuthor` flips
  // true after the client-side author check resolves.
  const { data: pageBroadcastData, updateData: updatePageBroadcastData } = useSyncedUserData<AnnotationData>(
    isPageAuthor ? pageId : '',
    'annotations',
    null,
    pageBroadcastSyncOptions
  )

  // Ref to sync pageBroadcastData when switching away from page-broadcast mode.
  // Captures current canvas state and pushes it into the reference hook so the
  // public reference layer shows fresh data without a re-fetch.
  // Declared here, assigned after canvasDataRef etc. are defined (see below).
  const updatePageBroadcastDataRef = useRef<(() => void) | null>(null)

  const [mode, setMode] = useState<AnnotationMode>('view')

  // Esc returns to view mode from any active tool (draw/erase/spacer).
  // Sticky-note placement has its own Esc handler in sticky-notes-layer.tsx;
  // both can fire harmlessly because each only acts when its mode is active.
  useEffect(() => {
    if (mode === 'view') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('view')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])
  const [pageVersion, setPageVersion] = useState<string>('')
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [canvasData, setCanvasData] = useState<string>('')
  // Memoized parsed strokes for SVG rendering of committed strokes
  const parsedStrokes = useMemo(() => parseStrokes(canvasData), [canvasData])
  // Layer badges visibility - hidden by default, shown when hovering layers dropdown in toolbar
  const [showLayerBadges, setShowLayerBadges] = useState(false)

  // Spacer state
  const [spacerPattern, setSpacerPattern] = useState<SpacerPattern>('blank')
  const [spacerInsertIndex, setSpacerInsertIndex] = useState<number | null>(null) // Hover insertion indicator
  const [spacerDeleteAnnotations, setSpacerDeleteAnnotations] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('spacer-delete-annotations')
      return saved !== null ? saved === 'true' : true // Default: enabled
    }
    return true
  })
  const handleSpacerDeleteAnnotationsChange = useCallback((value: boolean) => {
    setSpacerDeleteAnnotations(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('spacer-delete-annotations', value.toString())
    }
  }, [])

  // Toggle sticky note placement mode; ensure annotation canvas is in view mode so it doesn't eat clicks
  const handleStickyNotePlacementToggle = useCallback(() => {
    setStickyNotePlacementMode(m => !m)
    setMode('view')
  }, [setStickyNotePlacementMode])

  // Check if class broadcast and student feedback layers have content
  // IMPORTANT: When in the respective mode, use local canvasData/hasAnnotations state (which updates immediately)
  // because the useSyncedUserData hooks don't update until after save completes
  const hasClassBroadcastAnnotations = useMemo(() => {
    // When actively editing class broadcast, use local state for immediate feedback
    if (viewMode === 'class-broadcast') {
      return hasAnnotations || (spacersData?.spacers?.length ?? 0) > 0 || (snapsData?.snaps?.length ?? 0) > 0 || stickyNoteCount > 0
    }
    // Otherwise use the hook data or fallback ref
    const broadcastData = classBroadcastData?.canvasData || classBroadcastCanvasRef.current
    return !!(broadcastData && broadcastData.length > 0 && broadcastData !== '[]')
  }, [classBroadcastData, viewMode, hasAnnotations, spacersData?.spacers?.length, snapsData?.snaps?.length, stickyNoteCount])

  const hasStudentFeedbackAnnotations = useMemo(() => {
    // When actively editing student feedback, use local state for immediate feedback
    if (viewMode === 'student-view') {
      return hasAnnotations || (spacersData?.spacers?.length ?? 0) > 0 || (snapsData?.snaps?.length ?? 0) > 0 || stickyNoteCount > 0
    }
    // When in class-broadcast, check classStudents state (updated immediately when drawing)
    if (studentForFeedback) {
      const student = classStudents.find(s => s.id === studentForFeedback.id)
      if (student?.hasAnnotationsOnPage) return true
    }
    // Check fallback ref (data saved when switching modes)
    if (studentFeedbackCanvasRef.current && studentFeedbackCanvasRef.current !== '[]') {
      return true
    }
    // Fall back to hook data
    return !!(studentFeedbackData?.canvasData &&
      studentFeedbackData.canvasData.length > 0 &&
      studentFeedbackData.canvasData !== '[]')
  }, [studentFeedbackData, viewMode, hasAnnotations, studentForFeedback, classStudents, spacersData?.spacers?.length, snapsData?.snaps?.length, stickyNoteCount])

  // Track if page has page-broadcast content (annotations, spacers, snaps, sticky notes)
  const hasPageBroadcastAnnotations = useMemo(() => {
    // When actively editing page broadcast, use local state
    if (viewMode === 'page-broadcast') {
      return hasAnnotations || (spacersData?.spacers?.length ?? 0) > 0 || (snapsData?.snaps?.length ?? 0) > 0 || stickyNoteCount > 0
    }
    // Otherwise check server-passed public content
    return hasPublicContent
  }, [viewMode, hasAnnotations, hasPublicContent, spacersData?.spacers?.length, snapsData?.snaps?.length, stickyNoteCount])

  // Badge visibility logic:
  // 1. Toolbar hover: show ALL badges (including active layer)
  // 2. Drawing: show badges for OTHER layers only (not active layer)
  // 3. Not drawing + not hovering: no badges

  // Badge info for the active layer (main canvas)
  const activeLayerBadge = useMemo(() => {
    if (activeLayerKey === 'page-broadcast') {
      return { layerId: 'public', layerName: 'Public', layerColor: 'green' as const, icon: <Globe className="w-3 h-3" /> }
    }
    if (activeLayerKey === 'class-broadcast' && selectedClass) {
      return { layerId: `class-${selectedClass.id}`, layerName: selectedClass.name || 'Class', layerColor: 'blue' as const, icon: <Users className="w-3 h-3" /> }
    }
    if (activeLayerKey === 'student-feedback' && studentForFeedback) {
      return { layerId: 'individual-feedback', layerName: formatStudentLabel(studentForFeedback) || 'Feedback', layerColor: 'orange' as const, icon: <MessageSquare className="w-3 h-3" /> }
    }
    // Default: personal annotations
    return { layerId: 'personal', layerName: 'Personal', layerColor: 'blue' as const, icon: <User className="w-3 h-3" /> }
  }, [activeLayerKey, selectedClass, studentForFeedback])

  // Badge for the active layer (main canvas) - only on toolbar hover
  const showActiveLayerBadge = showLayerBadges

  // Badge for reference layers - on toolbar hover OR while drawing
  const shouldShowReferenceBadge = useCallback((_layerId: string) => {
    // Toolbar hover always shows all badges
    if (showLayerBadges) return true
    // If drawing, show badges for reference layers (they're always "other" layers)
    return mode !== 'view'
  }, [showLayerBadges, mode])

  // Canvas ref needed by delete callbacks
  const canvasRef = useRef<SimpleCanvasHandle | null>(null)

  // Delete class broadcast annotations specifically
  const deleteClassBroadcastData = useCallback(async () => {
    log('deleteClassBroadcastData called', {
      isTeacher,
      selectedClassId: selectedClass?.id,
      viewMode
    })
    if (isTeacher && selectedClass && updateClassBroadcastData) {
      // Clear the fallback ref
      classBroadcastCanvasRef.current = ''

      await updateClassBroadcastData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
      // Also clear spacers, snaps, and sticky notes for this class broadcast
      updateSpacersData({ spacers: [] })
      updateSnapsData({ snaps: [] })
      clearStickyNotes()
      // If currently viewing class broadcast, also clear local state
      if (viewMode === 'class-broadcast') {
        setCanvasData('')
        setHasAnnotations(false)
        if (canvasRef.current) {
          canvasRef.current.clear()
        }
      }
      // Update the brush icon indicator in the class dropdown
      setTeacherClasses(prev => prev.map(c =>
        c.id === selectedClass.id ? { ...c, hasAnnotationsOnPage: false } : c
      ))
    }
  }, [isTeacher, selectedClass, updateClassBroadcastData, viewMode, updateSpacersData, updateSnapsData, clearStickyNotes])

  // Delete student feedback annotations specifically
  // Works for both selected student and last selected student (in class-broadcast mode)
  const deleteStudentFeedbackData = useCallback(async () => {
    log('deleteStudentFeedbackData called', {
      isTeacher,
      studentForFeedbackId: studentForFeedback?.id,
      viewMode
    })
    if (!isTeacher || !studentForFeedback) return

    // Clear the fallback ref
    studentFeedbackCanvasRef.current = ''

    // Clear the data via the hook
    if (updateStudentFeedbackData) {
      await updateStudentFeedbackData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
    }
    // Also clear spacers, snaps, and sticky notes for this student feedback
    updateSpacersData({ spacers: [] })
    updateSnapsData({ snaps: [] })
    clearStickyNotes()

    // If currently drawing on this student, also clear local canvas
    if (viewMode === 'student-view') {
      setCanvasData('')
      setHasAnnotations(false)
      canvasRef.current?.clear()
    }

    // Update the indicator in the student list
    setClassStudents(prev => prev.map(s =>
      s.id === studentForFeedback.id ? { ...s, hasAnnotationsOnPage: false } : s
    ))
  }, [isTeacher, studentForFeedback, updateStudentFeedbackData, viewMode, updateSpacersData, updateSnapsData, clearStickyNotes])

  // Delete page broadcast annotations (for page authors).
  //
  // Annotations go through the dedicated `updatePageBroadcastData` hook
  // (always bound to targetType='page'). Snaps / sticky notes / spacers
  // are cleared by reusing the existing viewMode-driven hooks. When the
  // author is already in page-broadcast view those hooks are page-targeted,
  // so a plain update both writes the DB and refreshes local state. From
  // any other viewMode we route through `targetTypeOverride='page'` so the
  // active target (personal / class / student) is left untouched — at the
  // cost of the local state of the override target not updating, but that
  // doesn't matter because the author isn't looking at the page layer right
  // now anyway.
  const deletePageBroadcastData = useCallback(async () => {
    log('deletePageBroadcastData called', { viewMode })

    const inPageBroadcast = viewMode === 'page-broadcast'
    const clearOpts = inPageBroadcast
      ? { immediate: true as const }
      : { immediate: true as const, targetTypeOverride: 'page' as const, targetIdOverride: pageId }

    if (updatePageBroadcastData) {
      await updatePageBroadcastData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
    }
    await updateSpacersData({ spacers: [] }, clearOpts)
    await updateSnapsData({ snaps: [] }, clearOpts)

    // Sticky notes go through StickyNotesContext (sticky-notes-layer owns its
    // own useSyncedUserData hook).
    //
    // - In page-broadcast view the active sticky-notes hook is already
    //   page-targeted, so clearStickyNotes() persists empty notes to the same
    //   row and updates local state. No direct POST needed; doing both would
    //   race two writers against the same version counter.
    //
    // - From any other viewMode the active hook targets personal/class/student
    //   data, so we issue a direct sync POST against the page-targeted row.
    //   Fetch the current version first so the conflict check
    //   (server.version > item.version) passes cleanly.
    if (inPageBroadcast) {
      setCanvasData('')
      setHasAnnotations(false)
      canvasRef.current?.clear()
      clearStickyNotes()
    } else {
      try {
        const currentRes = await fetch(
          `/api/user-data/sticky-notes/${encodeURIComponent(pageId)}?targetType=page&targetId=${encodeURIComponent(pageId)}`,
        )
        const current = currentRes.ok ? await currentRes.json() : null
        const nextVersion = (current?.version ?? 0) + 1
        await fetch('/api/user-data/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{
              adapter: 'sticky-notes',
              itemId: pageId,
              data: JSON.stringify({ notes: [] }),
              version: nextVersion,
              updatedAt: Date.now(),
              targetType: 'page',
              targetId: pageId,
            }],
          }),
        })
      } catch (err) {
        log('sticky-notes page-broadcast clear failed', err)
      }
    }
  }, [
    viewMode,
    pageId,
    updatePageBroadcastData,
    updateSpacersData,
    updateSnapsData,
    clearStickyNotes,
  ])

  // Build list of available layers for the toolbar UI
  // This includes reference layers AND the currently active/editable layer
  const toolbarLayers = useMemo(() => {
    const layers: Array<{
      id: string
      label: string
      color: string
      visible: boolean
      hasContent: boolean
      isActive: boolean
      canDelete: boolean
    }> = []

    // Active layer (the one being edited) - always first
    // For students: their personal annotations
    // For teachers in my-view: their personal annotations
    // For teachers in class-broadcast: the class broadcast annotations
    // For teachers in student-view: the individual student feedback
    const activeLayerLabel = isTeacher
      ? viewMode === 'class-broadcast' && selectedClass
        ? `Class: ${selectedClass.name}`
        : viewMode === 'student-view' && selectedStudent
          ? `Feedback: ${formatStudentLabel(selectedStudent)}`
          : 'My annotations'
      : 'My annotations'

    layers.push({
      id: 'active',
      label: activeLayerLabel,
      color: 'border-primary',
      visible: true, // Active layer is always visible
      hasContent: hasAnnotations,
      isActive: true,
      canDelete: true // Active layer can always be cleared
    })

    // Personal layer as reference (for teachers when broadcasting)
    if (hasPersonalContent) {
      layers.push({
        id: 'personal',
        label: 'My annotations',
        color: 'border-gray-500',
        visible: isLayerVisible('personal'),
        hasContent: true,
        isActive: false,
        canDelete: false // Reference layers can't be deleted from here
      })
    }

    // Class layers (for students)
    if (isStudent && hasClassContent) {
      for (const classAnnotation of teacherClassAnnotations) {
        const layerId = `class-${classAnnotation.classId}`
        layers.push({
          id: layerId,
          label: classAnnotation.className,
          color: 'border-blue-500',
          visible: isLayerVisible(layerId),
          hasContent: true,
          isActive: false,
          canDelete: false
        })
      }
    }

    // Individual feedback (for students)
    if (isStudent && hasIndividualContent) {
      layers.push({
        id: 'individual',
        label: 'Teacher feedback',
        color: 'border-orange-500',
        visible: isLayerVisible('individual'),
        hasContent: true,
        isActive: false,
        canDelete: false
      })
    }

    return layers
  }, [
    isTeacher,
    viewMode,
    selectedClass,
    selectedStudent,
    hasAnnotations,
    hasPersonalContent,
    isStudent,
    hasClassContent,
    hasIndividualContent,
    teacherClassAnnotations,
    isLayerVisible
  ])
  const [headingPositions, setHeadingPositions] = useState<HeadingPosition[]>([])

  // Refs to track latest values for use in callbacks (avoids stale closure issues)
  const canvasDataRef = useRef<string>('')
  const pageVersionRef = useRef<string>('')
  const headingPositionsRef = useRef<HeadingPosition[]>([])
  const currentPaddingLeftRef = useRef<number>(0)

  // Assign the function now that refs are in scope
  // eslint-disable-next-line react-hooks/immutability -- Intentional: sync ref with latest values each render
  updatePageBroadcastDataRef.current = () => {
    const headingOffsets = Object.fromEntries(
      headingPositionsRef.current.map(h => [h.sectionId, h.offsetY])
    )
    updatePageBroadcastData({
      canvasData: canvasDataRef.current || '',
      headingOffsets,
      pageVersion: pageVersionRef.current,
      paddingLeft: currentPaddingLeftRef.current,
    } as AnnotationData)
  }

  // Save state tracking
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [stylusModeActive, setStylusModeActive] = useState(false)
  const [activePen, setActivePen] = useState(0)
  // Track if we're in "finger draw mode" (explicit draw mode without stylus)
  // In this mode, ALL touch events should be blocked for annotation, not just stylus
  const fingerDrawModeRef = useRef(false)

  // Track if pen is currently hovering or drawing - controls pointer-events on canvas
  const [penActive, setPenActive] = useState(false)
  // Use refs for zoom to avoid re-renders on every gesture
  const zoomRef = useRef(1.0)
  // Tracks the zoom level actually rendered in the DOM (updated only inside RAF, after DOM write).
  // Needed because zoomRef is updated immediately on each wheel event for accumulation, but
  // the RAF may be cancelled before it applies the transform. Using zoomRef as oldZoom for scroll
  // calculations would reference a never-rendered zoom, causing the focal point to drift top-left.
  const renderedZoomRef = useRef(1.0)
  const rafIdRef = useRef<number | null>(null)
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const initialPinchDistanceRef = useRef<number | null>(null)
  const initialZoomRef = useRef(1.0)
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null)
  // Store the content point under the initial pinch center (in unscaled content coordinates)
  const initialContentPointRef = useRef<{ x: number; y: number } | null>(null)
  // Scroll container ref for zoom-scroll sync
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  // Display-only zoom state (updated on gesture end, not during gesture)
  const [zoom, setZoom] = useState(1.0)
  // Default values used for both SSR and initial client render
  const defaultPenColors: [string, string, string] = ['#000000', '#FF0000', '#0000FF']
  const defaultPenSizes: [number, number, number] = [2, 2, 2]

  const [penColors, setPenColors] = useState<[string, string, string]>(defaultPenColors)
  const [penSizes, setPenSizes] = useState<[number, number, number]>(defaultPenSizes)

  // Load pen settings from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const savedColors = localStorage.getItem('annotation-pen-colors')
    if (savedColors) {
      try {
        const parsed = JSON.parse(savedColors)
        if (Array.isArray(parsed) && parsed.length === 3) {
          setPenColors(parsed as [string, string, string])
        }
      } catch (e) {
        console.error('Error loading pen colors:', e)
      }
    }

    const savedSizes = localStorage.getItem('annotation-pen-sizes')
    if (savedSizes) {
      try {
        const parsed = JSON.parse(savedSizes)
        if (Array.isArray(parsed) && parsed.length === 3) {
          setPenSizes(parsed as [number, number, number])
        }
      } catch (e) {
        console.error('Error loading pen sizes:', e)
      }
    }
  }, [])
  const contentRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const [eraserMarkedIds, setEraserMarkedIds] = useState<Set<string>>(new Set())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)
  const performSaveRef = useRef<(() => Promise<void>) | null>(null)
  const [pageHeight, setPageHeight] = useState(0)
  const [orphanedStrokesCount, setOrphanedStrokesCount] = useState(0)
  // Strokes whose sectionId currently doesn't resolve to a live DOM element.
  // These get rendered in a paper-anchored fallback overlay (no section to follow).
  // Updated by SectionAnchoredStrokes' onOrphansChange.
  const [domOrphanedStrokes, setDomOrphanedStrokes] = useState<AnimatedStroke[]>([])
  const [storedHeadingOffsets, setStoredHeadingOffsets] = useState<Record<string, number>>({})
  const [storedPaddingLeft, setStoredPaddingLeft] = useState<number | undefined>(undefined)
  const [currentPaddingLeft, setCurrentPaddingLeft] = useState<number>(0)

  // Derive snaps from synced data (convert SnapData to Snap type)
  // Memoized to prevent unnecessary re-renders of SnapsDisplay
  const snaps: Snap[] = useMemo(() => {
    return (snapsData?.snaps || []).map(snapData => ({
      id: snapData.id,
      name: snapData.name,
      imageUrl: snapData.imageUrl,
      top: snapData.top,
      left: snapData.left,
      width: snapData.width,
      height: snapData.height,
      sectionId: snapData.sectionId,
      sectionOffsetY: snapData.sectionOffsetY,
      color: snapData.color as Snap['color'],
      minimized: snapData.minimized,
    }))
  }, [snapsData?.snaps])

  // Extract teacher class snaps for students (from broadcast data)
  const teacherClassSnapsData = useMemo(() => {
    if (!isStudent || !teacherClassSnaps.length) return []

    return teacherClassSnaps.flatMap(classSnap => {
      const layerId = `class-${classSnap.classId}`
      if (!isLayerVisible(layerId)) return []

      const snapsData = classSnap.data as { snaps?: Snap[] } | null
      if (!snapsData?.snaps) return []

      // Tag each snap with its source for layer tracking
      return snapsData.snaps.map(snap => ({
        ...snap,
        id: `class-${classSnap.classId}-${snap.id}`, // Make IDs unique across layers
        layerId,
        layerName: classSnap.className,
        isTeacherSnap: true as const,
      }))
    })
  }, [isStudent, teacherClassSnaps, isLayerVisible])

  // Extract teacher individual feedback snaps for students
  const teacherIndividualSnapsData = useMemo(() => {
    if (!isStudent || !teacherIndividualSnapFeedback) return []
    if (!isLayerVisible('individual')) return []

    const snapsData = teacherIndividualSnapFeedback.data as { snaps?: Snap[] } | null
    if (!snapsData?.snaps) return []

    return snapsData.snaps.map(snap => ({
      ...snap,
      id: `individual-${snap.id}`, // Make IDs unique
      layerId: 'individual',
      layerName: teacherIndividualSnapFeedback.teacherName || 'Teacher',
      isTeacherSnap: true as const,
    }))
  }, [isStudent, teacherIndividualSnapFeedback, isLayerVisible])

  // Extract public snaps (from server-passed publicSnaps prop)
  // These are visible to all visitors when the 'public' layer is visible
  // Don't show when user is actively editing page-broadcast (they see their own edits in the main snaps list)
  const publicSnapsData = useMemo(() => {
    if (viewMode === 'page-broadcast') return [] // Author is editing, don't show server-passed snaps
    if (!isLayerVisible('public')) return []
    if (!publicSnaps.length) return []
    // When pageBroadcastData has loaded, SSR snaps may be stale — trust the hook
    if (pageBroadcastData !== null && (!pageBroadcastData.canvasData || pageBroadcastData.canvasData === '[]')) return []

    return publicSnaps.flatMap(publicSnap => {
      const snapsData = publicSnap.data as { snaps?: Snap[] } | null
      if (!snapsData?.snaps) return []

      return snapsData.snaps.map(snap => ({
        ...snap,
        id: `public-${publicSnap.userId}-${snap.id}`, // Make IDs unique across users
        layerId: 'public',
        layerName: publicSnap.user.name || 'Author',
        isTeacherSnap: true as const, // Display like teacher snaps (read-only for visitors)
      }))
    })
  }, [publicSnaps, isLayerVisible, viewMode, pageBroadcastData])

  // Combine all teacher snaps for students (including public snaps for all visitors)
  const allTeacherSnaps = useMemo(() => {
    return [...teacherClassSnapsData, ...teacherIndividualSnapsData, ...publicSnapsData]
  }, [teacherClassSnapsData, teacherIndividualSnapsData, publicSnapsData])

  // Filter out local snaps that are duplicates of public/teacher snaps
  // This prevents showing the same snap twice (once as deletable local, once as read-only public)
  // The public version takes precedence since it's the authoritative source.
  // Also gate by activeLayerVisible — the author's own snaps live on the active
  // layer (personal / page-broadcast / class-broadcast / student-feedback), so
  // they should hide when that layer is toggled off, the same way annotations
  // and sticky notes already do. Without this gate, hiding "Public" (= page-
  // broadcast for the author) hides their public strokes + post-its but leaves
  // the public snap stuck on screen.
  const filteredSnaps = useMemo(() => {
    if (!activeLayerVisible) return []
    if (allTeacherSnaps.length === 0) return snaps
    // Create a set of public snap imageUrls for fast lookup
    const publicSnapUrls = new Set(allTeacherSnaps.map(s => s.imageUrl))
    // Filter out any local snaps that have the same imageUrl as a public snap
    return snaps.filter(snap => !publicSnapUrls.has(snap.imageUrl))
  }, [snaps, allTeacherSnaps, activeLayerVisible])

  // Extract student work snaps for teachers viewing student's work
  const studentWorkSnapsData: StudentWorkSnap[] = useMemo(() => {
    if (!isTeacher || !studentForFeedback || !isLayerVisible('student-work')) return []

    const snapsData = studentWorkData?.snaps?.data as { snaps?: Snap[] } | null
    if (!snapsData?.snaps?.length) return []

    return snapsData.snaps.map(snap => ({
      ...snap,
      layerId: 'student-work',
      layerName: `${formatStudentLabel(studentForFeedback)}'s work`,
      isStudentWorkSnap: true as const,
    }))
  }, [isTeacher, studentForFeedback, studentWorkData, isLayerVisible])

  // Position overrides for teacher/public snaps (persisted via useSyncedUserData for all users)
  // Students can reposition class/individual feedback snaps, all users can reposition public snaps
  type SnapPositionOverrides = Record<string, { top: number; left: number; width: number; height: number }>
  type SnapOverridesData = { classSnaps: SnapPositionOverrides; feedbackSnaps: SnapPositionOverrides; publicSnaps?: SnapPositionOverrides; studentWorkSnaps?: SnapPositionOverrides }
  const emptySnapOverrides = useMemo(() => ({ classSnaps: {}, feedbackSnaps: {}, publicSnaps: {} } as SnapOverridesData), [])
  const { data: userSnapOverrides, updateData: updateSnapOverrides, isLoading: snapOverridesLoading } = useSyncedUserData<SnapOverridesData>(
    pageId, // Persist for all users (not just students) so public snap overrides work
    'snap-overrides',
    emptySnapOverrides
  )

  // Track initial load completion for unified fade-in of all annotation/snap content
  // We want to wait for all essential data to load before showing anything to prevent layout shift
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const initialLoadTriggeredRef = useRef(false)

  // Determine when initial load is complete (all essential data loaded)
  // This prevents multiple redraws during initial page load - one smooth fade-in after SSR
  useEffect(() => {
    if (initialLoadTriggeredRef.current) return

    // Wait for annotation, snap, and snap override loading to complete
    const isReady = !annotationLoading && !snapsLoading && !snapOverridesLoading

    if (isReady) {
      initialLoadTriggeredRef.current = true
      // Small delay to ensure all data is processed before showing
      const timer = setTimeout(() => {
        setInitialLoadComplete(true)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [annotationLoading, snapsLoading, snapOverridesLoading])

  // Teacher-side overrides for viewing student work snaps (local state, session only)
  const [teacherSnapOverrides, setTeacherSnapOverrides] = useState<SnapPositionOverrides>({})

  // Combined snap overrides - all users have persisted overrides, teachers also have local state for student work snaps
  const snapOverrides = useMemo(() => {
    const base = userSnapOverrides ?? { classSnaps: {}, feedbackSnaps: {}, publicSnaps: {} }
    if (isTeacher) {
      return { ...base, studentWorkSnaps: teacherSnapOverrides }
    }
    return base
  }, [userSnapOverrides, teacherSnapOverrides, isTeacher])

  // Callback for when user moves/resizes a teacher or public snap
  const handleTeacherSnapOverride = useCallback((
    snapId: string,
    layerType: 'class' | 'individual' | 'public',
    position: { top: number; left: number; width: number; height: number }
  ) => {
    const key = layerType === 'class' ? 'classSnaps' : layerType === 'public' ? 'publicSnaps' : 'feedbackSnaps'
    const currentOverrides = userSnapOverrides ?? { classSnaps: {}, feedbackSnaps: {}, publicSnaps: {} }
    updateSnapOverrides({
      classSnaps: currentOverrides.classSnaps ?? {},
      feedbackSnaps: currentOverrides.feedbackSnaps ?? {},
      publicSnaps: currentOverrides.publicSnaps ?? {},
      [key]: {
        ...(currentOverrides[key] ?? {}),
        [snapId]: position
      }
    })
  }, [userSnapOverrides, updateSnapOverrides])

  // Callback for when teacher moves/resizes a student work snap
  const handleStudentWorkSnapOverride = useCallback((
    snapId: string,
    position: { top: number; left: number; width: number; height: number }
  ) => {
    setTeacherSnapOverrides(prev => ({
      ...prev,
      [snapId]: position
    }))
  }, [])

  // Pen priority: pen always wins, ignore other inputs for 200ms after last pen event
  const lastPenEventTimeRef = useRef<number>(0)

  // Canvas width matches paper width exactly including padding
  // Paper element for portal (canvas renders directly into #paper)
  const [paperElement, setPaperElement] = useState<HTMLElement | null>(null)


  const [paperWidth, setPaperWidth] = useState(1280) // Fixed paper width (matches .paper-responsive)

  // Get paper element for portal and measure its width
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (paper) {
      setPaperElement(paper)

      // Use offsetWidth to get the untransformed width (ignores CSS transform scale on mobile)
      setPaperWidth(paper.offsetWidth)

      // Seed pageHeight from the paper's measured height at hydration time so the
      // public reference layer (gated on `pageHeight > 0`) can paint in the same
      // commit as the public sticky-notes/snaps. Without this seed, pageHeight
      // remains 0 until the 300ms-debounced ResizeObserver fires recalculate-
      // HeadingPositions, which delays the drawn public layer by ~250-400ms
      // after the first paper paint. The accurate height (after code editors
      // mount, KaTeX, etc.) still arrives via the ResizeObserver path; strokes
      // are positioned via per-section transforms so initial vs final height
      // doesn't shift them.
      setPageHeight(paper.offsetHeight)

      // Ensure paper has position:relative for absolute canvas positioning
      paper.style.position = 'relative'

      // Allow snaps to overflow paper boundaries
      paper.style.overflow = 'visible'
    }
  }, [viewportWidth])

  // Track annotating state in ref for event handlers (avoids stale closure issues)
  const isAnnotatingRef = useRef(false)
  useEffect(() => {
    isAnnotatingRef.current = mode !== 'view' || stylusModeActive
    // Finger draw mode: user explicitly activated draw/erase without a stylus
    // In this mode, ALL touch input should draw, not scroll
    fingerDrawModeRef.current = mode !== 'view' && !stylusModeActive
  }, [mode, stylusModeActive])

  // Add annotation-active class to paper when in draw/erase mode (prevents text selection on iOS Safari)
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (!paper) return

    const isAnnotating = mode !== 'view' || stylusModeActive

    if (isAnnotating) {
      paper.classList.add('annotation-active')
    } else {
      paper.classList.remove('annotation-active')
    }

    return () => {
      paper.classList.remove('annotation-active')
    }
  }, [mode, stylusModeActive])

  // Prevent selection globally when annotating (capture phase for all touch/pointer events)
  useEffect(() => {
    const preventSelection = (e: Event) => {
      if (isAnnotatingRef.current) {
        e.preventDefault()
        return false
      }
    }

    // Track pen events to block associated touch events
    // On iOS Safari, pen input triggers BOTH pointer AND touch events
    // We need to block the touch events that occur immediately after pen events
    const preventDefaultForPen = (e: PointerEvent) => {
      if (!isAnnotatingRef.current) return

      // Update pen timestamp when pen is used
      if (e.pointerType === 'pen') {
        lastPenEventTimeRef.current = Date.now()
      }

      // In finger draw mode, block ALL pointer events on paper (touch draws, not scrolls)
      if (fingerDrawModeRef.current) {
        const target = e.target as Element
        if (target?.tagName === 'CANVAS' || target?.closest('#paper')) {
          e.preventDefault()
        }
        return
      }

      // Only prevent for pen/stylus, allow touch/mouse through for scrolling
      if (e.pointerType !== 'pen') return

      const target = e.target as Element
      // Only prevent on canvas or when target is inside paper
      if (target?.tagName === 'CANVAS' || target?.closest('#paper')) {
        e.preventDefault()
      }
    }

    // Block touch events that occur immediately after pen events
    // This prevents the "phantom scroll" when pen touches the screen
    // Also blocks ALL touch in finger draw mode
    const preventTouchDuringPen = (e: TouchEvent) => {
      if (!isAnnotatingRef.current) return

      const target = e.target as Element
      const isOnPaper = target?.tagName === 'CANVAS' || target?.closest('#paper')

      // In finger draw mode, block ALL touch events on paper
      if (fingerDrawModeRef.current && isOnPaper) {
        e.preventDefault()
        return
      }

      // Otherwise, only block touch events that occur immediately after pen events
      const timeSinceLastPen = Date.now() - lastPenEventTimeRef.current
      // If a touch event happens within 300ms of pen activity, block it
      // This is likely a touch event triggered by the pen itself, not a finger
      if (timeSinceLastPen < 300 && isOnPaper) {
        e.preventDefault()
      }
    }

    document.addEventListener('selectstart', preventSelection, true)
    document.addEventListener('pointerdown', preventDefaultForPen, { capture: true, passive: false })
    document.addEventListener('pointermove', preventDefaultForPen, { capture: true, passive: false })
    document.addEventListener('pointerup', preventDefaultForPen, { capture: true, passive: false })
    // Block touch events that occur during/after pen events to prevent scroll
    document.addEventListener('touchstart', preventTouchDuringPen, { capture: true, passive: false })
    document.addEventListener('touchmove', preventTouchDuringPen, { capture: true, passive: false })

    return () => {
      document.removeEventListener('selectstart', preventSelection, true)
      document.removeEventListener('pointerdown', preventDefaultForPen, true)
      document.removeEventListener('pointermove', preventDefaultForPen, true)
      document.removeEventListener('pointerup', preventDefaultForPen, true)
      document.removeEventListener('touchstart', preventTouchDuringPen, true)
      document.removeEventListener('touchmove', preventTouchDuringPen, true)
    }
  }, [])

  // Handle pen state changes from canvas - this is more reliable than document-level listeners
  // because pen events are captured by the canvas via setPointerCapture
  const handlePenStateChange = useCallback((active: boolean) => {
    setPenActive(active)
  }, [])


  // Save pen colors to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-pen-colors', JSON.stringify(penColors))
    }
  }, [penColors])

  // Save pen sizes to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-pen-sizes', JSON.stringify(penSizes))
    }
  }, [penSizes])


  // Generate page version hash
  useEffect(() => {
    generateContentHash(content).then(hash => {
      setPageVersion(hash)
      pageVersionRef.current = hash
    })
  }, [content])

  // Keep refs in sync with state (for use in callbacks to avoid stale closures)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- Intentional: sync ref with prop for callbacks
    canvasDataRef.current = canvasData
  }, [canvasData])

  useEffect(() => {
    headingPositionsRef.current = headingPositions
  }, [headingPositions])

  useEffect(() => {
    currentPaddingLeftRef.current = currentPaddingLeft
  }, [currentPaddingLeft])

  // Check for version mismatch and sync to global provider for SyncStatusButton
  // Only check if we have actual annotation data with content AND a stored version
  // Skip if canvasData is empty (cleared annotations) or pageVersion is empty
  useEffect(() => {
    if (pageVersion && annotationData && annotationData.canvasData && annotationData.pageVersion) {
      const mismatch = annotationData.pageVersion !== pageVersion
      setAnnotationVersionMismatch(mismatch && hasAnnotations)
    } else {
      setAnnotationVersionMismatch(false)
    }
  }, [pageVersion, annotationData, hasAnnotations, setAnnotationVersionMismatch])

  // Track previous targeting key AND syncOptions to detect class/student switches
  const prevTargetingKeyRef = useRef(targetingKey)
  const prevSyncOptionsRef = useRef(syncOptions)

  // Keep prevSyncOptionsRef in sync - but ONLY when targetingKey hasn't changed
  // This allows us to capture the "old" syncOptions before a switch
  useEffect(() => {
    // Only update if we're not in the middle of a switch
    if (prevTargetingKeyRef.current === targetingKey) {
      prevSyncOptionsRef.current = syncOptions
    }
  }, [syncOptions, targetingKey])

  // Reset canvas state when targeting changes (e.g., teacher switches class)
  // This MUST run before the data loading effect below
  useEffect(() => {
    // Skip on initial mount (no previous value to compare)
    if (prevTargetingKeyRef.current === targetingKey) return

    // Capture the OLD syncOptions before they get overwritten
    const oldSyncOptions = prevSyncOptionsRef.current
    log('Target switching from', prevTargetingKeyRef.current, 'to', targetingKey)
    log('Saving with OLD syncOptions:', oldSyncOptions)

    // IMPORTANT: Save any pending changes BEFORE resetting state
    // This ensures data written to the old target is persisted before we switch
    // (e.g., student feedback saved before switching to class-broadcast)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    // Perform immediate save with the OLD sync options
    // We call performSaveWithOptions directly instead of performSaveRef
    // to ensure we save to the correct target
    performSaveWithOptionsRef.current?.(oldSyncOptions)

    // Update the refs AFTER saving
    prevTargetingKeyRef.current = targetingKey
    prevSyncOptionsRef.current = syncOptions

    // Clear local canvas state to allow new data to load
    setCanvasData('')
    setHasAnnotations(false)
    setStoredHeadingOffsets({})
    setStoredPaddingLeft(undefined)
  }, [targetingKey, syncOptions])

  // Load annotations from user data service
  // Runs when annotationData changes OR when canvas was cleared (canvasData becomes empty)
  useEffect(() => {
    // Don't reload if we're in the middle of clearing
    if (isClearingRef.current) return

    // Don't reload if we already have canvas data (user is drawing)
    // Exception: Allow reload if canvasData is empty (just switched targets or initial load)
    if (canvasData) return

    if (annotationData && annotationData.canvasData) {
      try {
        const strokes: StrokeData[] = JSON.parse(annotationData.canvasData)

        if (strokes.length > 0) {
          setHasAnnotations(true)
          setCanvasData(annotationData.canvasData)
          log('loaded strokes sectionIds:', strokes.map(s => s.sectionId).join(', '))
          log('loaded storedHeadingOffsets:', JSON.stringify(annotationData.headingOffsets))
          hasLoadedAnnotationOffsets.current = true
          const offsets = annotationData.headingOffsets || {}
          setStoredHeadingOffsets(offsets)
          setStoredPaddingLeft(annotationData.paddingLeft)
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [annotationData, canvasData, targetingKey])

  // Initialize storedHeadingOffsets when heading positions are first available
  // BUT only if there are no annotations loaded (which carry their own saved offsets).
  // Using a ref to avoid the race condition where this effect's stale closure
  // overwrites offsets that the annotationData effect just set.
  const hasLoadedAnnotationOffsets = useRef(false)
  useEffect(() => {
    // While the user has no content yet, keep the baseline tracking the
    // current layout. Dynamic-height elements (code editors, callouts) can
    // grow AFTER the initial 500ms recalc but BEFORE the user draws — if we
    // froze the baseline at page load, the first stroke would render with
    // dy = (post-grow current) - (pre-grow baseline) and visibly shift until
    // performSave rebases the baseline 2s later.
    if (headingPositions.length === 0) return
    if (hasLoadedAnnotationOffsets.current) return
    if (hasAnnotations) return
    const currentOffsets = Object.fromEntries(
      headingPositions.map(h => [h.sectionId, h.offsetY])
    )
    setStoredHeadingOffsets(currentOffsets)
  }, [headingPositions, hasAnnotations])

  // Reposition snaps when heading positions change (snaps use CSS top/left, not SVG transforms).
  // Strokes no longer need repositioning here — the SVG layer handles it via per-stroke
  // sectionOffsetY transforms at render time, keeping stroke data pristine.
  useEffect(() => {
    if (headingPositions.length === 0 || Object.keys(storedHeadingOffsets).length === 0) return

    const currentOffsets = Object.fromEntries(
      headingPositions.map(h => [h.sectionId, h.offsetY])
    )

    const needsVerticalReposition = Object.keys(storedHeadingOffsets).some(
      key => storedHeadingOffsets[key] !== currentOffsets[key]
    )
    const needsHorizontalReposition = storedPaddingLeft !== undefined &&
      Math.abs(currentPaddingLeft - storedPaddingLeft) > 1

    if (!needsVerticalReposition && !needsHorizontalReposition) return

    // Reposition snaps if we have any
    if (snaps.length > 0) {
      const snapResult = repositionSnaps(
        snaps,
        headingPositions,
        storedHeadingOffsets,
        currentPaddingLeft,
        storedPaddingLeft
      )
      updateSnapsData({ snaps: snapResult.snaps })
    }

    // Update stored values so we don't reposition snaps again
    setStoredHeadingOffsets(currentOffsets)
    setStoredPaddingLeft(currentPaddingLeft)
  }, [headingPositions, storedHeadingOffsets, currentPaddingLeft, storedPaddingLeft, snaps, updateSnapsData])

  // Helper function to recalculate heading positions and paper dimensions
  const recalculateHeadingPositions = useCallback(() => {
    if (!contentRef.current) return

    // Get full paper dimensions including padding
    const paperElement = document.getElementById('paper')
    if (paperElement) {
      setPageHeight(paperElement.offsetHeight)

      // Also recalculate paper dimensions when content changes
      const style = window.getComputedStyle(paperElement)

      const paddingLeft = parseFloat(style.paddingLeft) || 0

      // Track current padding for horizontal repositioning
      setCurrentPaddingLeft(paddingLeft)

      // Use offsetWidth to get the untransformed width (ignores CSS transform scale)
      // getBoundingClientRect().width returns the scaled size on mobile, but we need
      // the actual 1280px width for canvas coordinates to align with content
      setPaperWidth(paperElement.offsetWidth)
    }

    // Query for all elements with data-section-id (headings, code blocks, callouts, etc.)
    const sectionElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
    const positions: HeadingPosition[] = []

    // Get the CSS transform scale factor applied to paper (for mobile responsive scaling)
    // getBoundingClientRect() returns scaled coordinates, but we need unscaled for canvas.
    // Compute scale from WIDTH not height: paper width is hard-locked at 1280 px so
    // offsetWidth is exact, and paperRect.width / 1280 gives a clean transform scale.
    // offsetHeight, by contrast, is integer-rounded by the browser while
    // paperRect.height carries subpixels — yielding a spurious "scale" of e.g.
    // 1.000057 even when no transform is applied. That subpixel error propagates
    // into every sectionOffsetY (each shrunk by ~0.06%), and the canvas — which
    // uses width-based scale — disagrees, producing a sectionOffsetY → point.y
    // mismatch that grows linearly with y (visible as a few-pixel drift between
    // canvas-drawn and SVG-rendered strokes near the bottom of the page).
    const paperRect = paperElement!.getBoundingClientRect()
    const scale = (paperRect.width / paperElement!.offsetWidth) || 1
    // sectionOffsetY must use the CANVAS's actual coord origin as anchor.
    // The canvas lives inside .annotation-content-wrapper (`position: absolute;
    // inset: 0` inside paper, so it sits at paper's padding edge). Measure that
    // wrapper's rect directly — at heavy zoom, computing it from paperRect.top +
    // paperBorderTop * scale drifts because the browser rounds border rendering
    // at the device-pixel grid, which doesn't equal the multiplied value.
    const wrapperEl = paperElement!.querySelector('.annotation-content-wrapper') as HTMLElement | null
    const originRect = wrapperEl ? wrapperEl.getBoundingClientRect() : paperRect

    sectionElements.forEach((element) => {
      const sectionId = element.getAttribute('data-section-id')
      const headingText = element.getAttribute('data-heading-text')
      const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

      if (sectionId) {
        // Get the element's position relative to paper element
        // Divide by scale to convert from scaled (getBoundingClientRect) to unscaled (canvas) coordinates
        const rect = element.getBoundingClientRect()
        const unscaledOffsetY = (rect.top - originRect.top) / scale

        // Add top reference point
        positions.push({
          sectionId,
          offsetY: unscaledOffsetY,
          headingText: headingText || ''
        })


        // For dynamic-height elements (callouts, code editors), also track bottom
        // This ensures annotations BELOW these elements move when they expand/collapse
        if (isDynamicHeight) {
          positions.push({
            sectionId: `${sectionId}-end`,
            offsetY: (rect.bottom - originRect.top) / scale,
            headingText: ''
          })
        }
      }
    })

    log('recalcHeadingPositions:', positions.map(p => `${p.sectionId}@${Math.round(p.offsetY)}`).join(', '))
    setHeadingPositions(positions)
  }, [])

  // Recalculate heading positions when teacher broadcast data arrives
  // This fixes a timing issue on iPad where page height may not be fully calculated yet
  useEffect(() => {
    if (classBroadcastCanvasDataRef.current) {
      recalculateHeadingPositions()
    }
  }, [classBroadcastData?.canvasData, recalculateHeadingPositions])

  // Track heading positions on window resize / font-size change.
  // Trailing debounce: the browser fires ~48 resize events across different frames
  // during initial load (SQL editors mounting, KaTeX, images settling). A per-frame
  // rAF guard still let each of those through; a 300ms trailing debounce collapses
  // the whole burst into one recalc after the layout settles. The annotation layer
  // fades in over ~500ms anyway, so a 300ms delay is invisible to the user.
  useEffect(() => {
    const DEBOUNCE_MS = 300
    let timerId: ReturnType<typeof setTimeout> | null = null

    const handleResize = () => {
      if (timerId !== null) clearTimeout(timerId)
      timerId = setTimeout(() => {
        timerId = null
        recalculateHeadingPositions()
      }, DEBOUNCE_MS)
    }

    window.addEventListener('resize', handleResize)
    // Also listen for font size changes from font-size-controls
    window.addEventListener('eduskript:fontsize-change', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('eduskript:fontsize-change', handleResize)
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [recalculateHeadingPositions])

  // Watch the entire content container for size changes.
  // Any element growing/shrinking (callouts, editors, images, datacube, etc.)
  // triggers recalculation so annotations reposition correctly.
  // Same 300ms trailing debounce as the window-resize handler above.
  useEffect(() => {
    if (!contentRef.current) return

    const DEBOUNCE_MS = 300
    let timerId: ReturnType<typeof setTimeout> | null = null

    const scheduleRecalculation = () => {
      if (timerId !== null) clearTimeout(timerId)
      timerId = setTimeout(() => {
        timerId = null
        recalculateHeadingPositions()
      }, DEBOUNCE_MS)
    }

    const resizeObserver = new ResizeObserver(scheduleRecalculation)
    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [children, recalculateHeadingPositions])

  // =========================================================================
  // Spacer DOM injection
  // Injects spacer divs as real DOM elements between content blocks.
  // This pushes content down (not an overlay), and recalculates heading
  // positions so annotations below spacers reposition automatically.
  // =========================================================================

  // Derive spacers from synced data (user's own spacers)
  const spacers: Spacer[] = useMemo(() => spacersData?.spacers || [], [spacersData?.spacers])

  // Derive broadcast spacers for students (teacher → student)
  const broadcastSpacers: Spacer[] = useMemo(() => {
    if (!isStudent) return []
    const result: Spacer[] = []

    // Class broadcast spacers
    for (const classSpacerData of (teacherClassSpacers || [])) {
      const data = classSpacerData.data as { spacers?: Spacer[] } | null
      if (data?.spacers) {
        result.push(...data.spacers)
      }
    }

    // Individual spacer feedback
    if (teacherIndividualSpacerFeedback) {
      const data = teacherIndividualSpacerFeedback.data as { spacers?: Spacer[] } | null
      if (data?.spacers) {
        result.push(...data.spacers)
      }
    }

    return result
  }, [isStudent, teacherClassSpacers, teacherIndividualSpacerFeedback])

  // All spacers to inject (own + broadcast)
  const allSpacersToInject: Spacer[] = useMemo(() => {
    // Dedupe by id (own spacers take precedence)
    const ids = new Set(spacers.map(s => s.id))
    return [...spacers, ...broadcastSpacers.filter(s => !ids.has(s.id))]
  }, [spacers, broadcastSpacers])

  // Helper: get the .markdown-content container (the actual parent of block elements)
  const getMarkdownContainer = useCallback(() => {
    if (!contentRef.current) return null
    return contentRef.current.querySelector('.markdown-content') ?? contentRef.current
  }, [])

  // Helper: get block children (non-spacer direct children of markdown container)
  const getBlockChildren = useCallback(() => {
    const container = getMarkdownContainer()
    if (!container) return []
    return Array.from(container.children).filter(
      el => !el.hasAttribute('data-spacer-id') && !el.hasAttribute('data-spacer-end')
    )
  }, [getMarkdownContainer])

  // Inject spacer DOM elements between block children of .markdown-content
  useEffect(() => {
    const container = getMarkdownContainer()
    if (!container) return

    // In-place sync: keep existing spacer/sentinel DOM elements stable across
    // height/pattern changes. A naive teardown+rebuild here causes a 1-frame
    // flicker on every height commit because portal targets (cached by
    // SectionAnchoredStrokes / SnapsDisplay / sticky-notes-layer) briefly
    // point at detached nodes between teardown and re-injection.
    const existingSpacers = new Map<string, HTMLElement>()
    container.querySelectorAll('[data-spacer-id]').forEach(el => {
      const id = (el as HTMLElement).getAttribute('data-spacer-id')
      if (id) existingSpacers.set(id, el as HTMLElement)
    })
    const existingSentinels = new Map<string, HTMLElement>()
    container.querySelectorAll('[data-spacer-end]').forEach(el => {
      const id = (el as HTMLElement).getAttribute('data-spacer-end')
      if (id) existingSentinels.set(id, el as HTMLElement)
    })

    const targetIds = new Set(allSpacersToInject.map(s => s.id))

    // Remove spacers no longer in the target set
    let removedAny = false
    for (const [id, el] of existingSpacers) {
      if (!targetIds.has(id)) {
        el.remove()
        existingSentinels.get(id)?.remove()
        removedAny = true
      }
    }
    // Sweep any orphaned sentinels (e.g. from older state)
    for (const [id, el] of existingSentinels) {
      if (!targetIds.has(id)) el.remove()
    }

    if (allSpacersToInject.length === 0) {
      return
    }

    // Sort spacers by afterBlockIndex descending so new insertions don't shift
    // indices of later inserts. (Existing spacers stay where they are.)
    const sorted = [...allSpacersToInject].sort((a, b) => b.afterBlockIndex - a.afterBlockIndex)

    let createdAnyNew = false
    for (const spacer of sorted) {
      const existingDiv = existingSpacers.get(spacer.id)

      if (existingDiv) {
        // In-place update for height/pattern changes — no teardown, no flicker.
        // Class is rewritten in full to swap pattern variants.
        existingDiv.className = `spacer-element spacer-${spacer.pattern}`
        if (existingDiv.style.height !== `${spacer.height}px`) {
          existingDiv.style.height = `${spacer.height}px`
        }
        // Sentinel needs no update — it's always 0-height and sits right after.
        continue
      }

      // New spacer — create + insert. Re-query block children excluding any
      // spacer/sentinel elements so afterBlockIndex maps onto content blocks.
      const currentChildren = Array.from(container.children).filter(
        el => !el.hasAttribute('data-spacer-id') && !el.hasAttribute('data-spacer-end')
      )
      const clampedIndex = Math.min(spacer.afterBlockIndex, currentChildren.length - 1)
      if (clampedIndex < 0) continue
      const targetChild = currentChildren[clampedIndex]
      if (!targetChild) continue

      const spacerDiv = document.createElement('div')
      spacerDiv.setAttribute('data-spacer-id', spacer.id)
      // Spacer is also a section divider: its top anchors strokes immediately above
      // (assigned to spacer-{id}) and its bottom anchors strokes below (assigned to
      // spacer-{id}-end via the sentinel sibling). Both follow as the spacer's height
      // changes, with no JS recalc — same pattern as callouts/code-editors/plugins.
      spacerDiv.setAttribute('data-section-id', `spacer-${spacer.id}`)
      spacerDiv.setAttribute('data-dynamic-height', 'true')
      spacerDiv.className = `spacer-element spacer-${spacer.pattern}`
      spacerDiv.style.height = `${spacer.height}px`
      // CSS already sets [data-section-id] { position: relative } so absolute children anchor here.

      const endSentinel = document.createElement('div')
      endSentinel.setAttribute('data-section-id', `spacer-${spacer.id}-end`)
      endSentinel.setAttribute('data-section-end', 'true')
      endSentinel.setAttribute('data-spacer-end', spacer.id) // for cleanup query
      endSentinel.setAttribute('aria-hidden', 'true')
      endSentinel.style.cssText = 'height:0;pointer-events:none'

      targetChild.after(spacerDiv)
      spacerDiv.after(endSentinel)
      createdAnyNew = true
    }

    // Recalculate heading positions only when DOM topology actually changed
    // (added or removed spacers). Pure height tweaks already reflow via the
    // browser layout engine; a JS recalc would just re-trigger the section-
    // target re-resolution effects unnecessarily. New strokes drawn during a
    // drag still get the correct sectionId because determineSectionFromY runs
    // against current headingPositions only at draw time, by which point the
    // commit-time recalc has already fired.
    if (createdAnyNew || removedAny) {
      recalculateHeadingPositions()
    }
  }, [allSpacersToInject, children, recalculateHeadingPositions, getMarkdownContainer])

  // Track ID of the most recently created spacer so the floating panel auto-opens
  const [lastCreatedSpacerId, setLastCreatedSpacerId] = useState<string | null>(null)
  const [spacerResizing, setSpacerResizing] = useState(false)

  // When a new spacer is added inside an existing section, items (strokes,
  // notes, snaps) that visually fall *below* the new spacer need to re-anchor
  // to the spacer's end-sentinel so they follow subsequent height changes.
  // Without re-anchor, they stay tied to the parent section's top — which
  // doesn't move when the spacer grows, so they don't move either. This ref
  // tracks the spacer that needs reassignment; the effect below runs once
  // per add, after the spacer's DOM is in place and headingPositions has its
  // entries.
  const pendingSpacerReassignmentRef = useRef<{ id: string; height: number } | null>(null)

  // Spacer CRUD operations
  const handleAddSpacer = useCallback((afterBlockIndex: number) => {
    const id = crypto.randomUUID()
    const newSpacer: Spacer = {
      id,
      afterBlockIndex,
      height: 80,
      pattern: spacerPattern,
    }
    setLastCreatedSpacerId(id)
    pendingSpacerReassignmentRef.current = { id, height: 80 }
    const current = spacersData?.spacers || []
    updateSpacersData({ spacers: [...current, newSpacer] })
  }, [spacerPattern, spacersData, updateSpacersData])

  // Use ref to avoid stale closure — resize saves height, then pattern change
  // must read the latest spacersData (not the one captured before resize)
  const spacersDataRef = useRef(spacersData)
  spacersDataRef.current = spacersData

  const handleUpdateSpacer = useCallback((id: string, updates: Partial<Spacer>) => {
    const current = spacersDataRef.current?.spacers || []
    updateSpacersData({
      spacers: current.map(s => s.id === id ? { ...s, ...updates } : s)
    })
  }, [updateSpacersData])

  const handleRemoveSpacer = useCallback((id: string) => {
    // When a spacer is removed, every annotation anchored to `spacer-{id}` or
    // `spacer-{id}-end` needs handling. Two coupled subtleties make this
    // trickier than a simple "shift y by spacer height":
    //
    //   1. The spacer may have been resized between add and remove. The +H
    //      shift applied on add used the height-at-add (e.g. 80), but the
    //      spacer's current height (e.g. 200) is what `spacers[i].height`
    //      reports. Subtracting current height would over-correct, leaving
    //      strokes drifted up by (h_current − h_at_add). Instead we recover
    //      h_at_anchor from `stored.sectionOffsetY − NT` — that's the
    //      spacer's height at whichever moment the item became anchored to
    //      spacer-end (either add-time re-anchor of items below the
    //      insertion point, or direct draw inside the resized spacer).
    //
    //   2. The in-spacer/below-spacer split must be done on the item's
    //      CURRENT visual paper-y, not its stored y. After resize, an item
    //      whose stored y is "inside the spacer's stored coords" may visually
    //      sit below the resized spacer (because the section-anchor
    //      magic placed it there using the live spacer-end position).
    //      Compute visual_y = section.live.offsetY + (stored.y − stored.sectionOffsetY)
    //      and check that against the spacer's live range.
    //
    // In-spacer items get deleted (default) or re-anchored without y change.
    // Below-spacer items get re-anchored to the divider above with
    //   stored.y -= (stored.sectionOffsetY − NT)
    // which un-applies the original +H shift exactly, regardless of any
    // resize that happened in between.
    const NT = headingPositions.find(h => h.sectionId === `spacer-${id}`)?.offsetY
    const NE = headingPositions.find(h => h.sectionId === `spacer-${id}-end`)?.offsetY
    const prevDivider = NT !== undefined
      ? headingPositions
          .filter(h =>
            h.sectionId !== `spacer-${id}` &&
            h.sectionId !== `spacer-${id}-end` &&
            h.offsetY < NT
          )
          .sort((a, b) => b.offsetY - a.offsetY)[0]
      : undefined

    const isSpacerSection = (sid: string | undefined): boolean =>
      sid === `spacer-${id}` || sid === `spacer-${id}-end`
    // Visual paper-y of an item: its current rendered position in paper-local
    // coords. Returns undefined if the section can't be resolved (item
    // anchored to a stale section we no longer know about).
    const visualPaperY = (storedY: number, storedSectionOffsetY: number, storedSectionId: string): number | undefined => {
      const entry = headingPositions.find(h => h.sectionId === storedSectionId)
      if (!entry) return undefined
      return entry.offsetY + (storedY - storedSectionOffsetY)
    }
    const isInSpacer = (visualY: number | undefined): boolean =>
      visualY !== undefined && NT !== undefined && NE !== undefined && visualY >= NT && visualY <= NE
    // Y shift that un-applies the spacer height that was baked into stored y
    // at anchor-to-spacer-end time. Equals 0 for items anchored to spacer-{id}
    // (top sentinel, sectionOffsetY = NT) — those don't have any baked-in
    // shift. Equals h_at_anchor for items at spacer-{id}-end.
    const reanchorShift = (storedSectionOffsetY: number): number =>
      NT !== undefined ? -(storedSectionOffsetY - NT) : 0

    // ── Strokes ──────────────────────────────────────────────────────────
    if (canvasData) {
      try {
        const strokes = JSON.parse(canvasData) as StrokeData[]
        let changed = false
        const next: StrokeData[] = []
        for (const stroke of strokes) {
          if (!isSpacerSection(stroke.sectionId)) {
            next.push(stroke)
            continue
          }
          const refY = stroke.points[0]?.y ?? stroke.avgY ?? 0
          const visY = visualPaperY(refY, stroke.sectionOffsetY, stroke.sectionId)
          if (isInSpacer(visY)) {
            if (spacerDeleteAnnotations) {
              changed = true
              continue // delete
            }
            if (prevDivider) {
              changed = true
              next.push({
                ...stroke,
                sectionId: prevDivider.sectionId,
                sectionOffsetY: prevDivider.offsetY,
              })
              continue
            }
          } else if (prevDivider) {
            const shift = reanchorShift(stroke.sectionOffsetY)
            changed = true
            next.push({
              ...stroke,
              sectionId: prevDivider.sectionId,
              sectionOffsetY: prevDivider.offsetY,
              points: stroke.points.map(p => ({ ...p, y: p.y + shift })),
              avgY: stroke.avgY !== undefined ? stroke.avgY + shift : stroke.avgY,
            })
            continue
          }
          next.push(stroke)
        }
        if (changed) {
          const newData = JSON.stringify(next)
          setCanvasData(newData)
          setHasAnnotations(next.length > 0)
          const currentOffsets = Object.fromEntries(
            headingPositions.map(h => [h.sectionId, h.offsetY])
          )
          updateAnnotationData({
            canvasData: newData,
            headingOffsets: currentOffsets,
            pageVersion: pageVersionRef.current,
            paddingLeft: currentPaddingLeft,
          })
        }
      } catch { /* ignore parse errors */ }
    }

    // ── Snaps ────────────────────────────────────────────────────────────
    {
      const currentSnaps = snapsData?.snaps || []
      let changed = false
      const nextSnaps: typeof currentSnaps = []
      for (const snap of currentSnaps) {
        if (!isSpacerSection(snap.sectionId)) {
          nextSnaps.push(snap)
          continue
        }
        const sectionOffsetY = snap.sectionOffsetY
        if (sectionOffsetY === undefined) {
          nextSnaps.push(snap)
          continue
        }
        const visY = visualPaperY(snap.top, sectionOffsetY, snap.sectionId!)
        if (isInSpacer(visY)) {
          if (spacerDeleteAnnotations) {
            changed = true
            continue
          }
          if (prevDivider) {
            changed = true
            nextSnaps.push({
              ...snap,
              sectionId: prevDivider.sectionId,
              sectionOffsetY: prevDivider.offsetY,
            })
            continue
          }
        } else if (prevDivider) {
          const shift = reanchorShift(sectionOffsetY)
          changed = true
          nextSnaps.push({
            ...snap,
            sectionId: prevDivider.sectionId,
            sectionOffsetY: prevDivider.offsetY,
            top: snap.top + shift,
          })
          continue
        }
        nextSnaps.push(snap)
      }
      if (changed) updateSnapsData({ snaps: nextSnaps })
    }

    // ── Sticky notes (handled by sticky-notes-layer.tsx) ─────────────────
    // Send the heading-positions snapshot so the receiver can replicate
    // visualPaperY without needing its own layout query.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('eduskript:unanchor-spacer-removed', {
        detail: {
          spacerId: id,
          prevSectionId: prevDivider?.sectionId,
          prevSectionOffsetY: prevDivider?.offsetY,
          spacerTop: NT,
          spacerEnd: NE,
          deleteInSpacer: spacerDeleteAnnotations,
          headingPositions,
        },
      }))
    }

    const current = spacersData?.spacers || []
    updateSpacersData({ spacers: current.filter(s => s.id !== id) })
    // Exit spacer mode after a delete — same UX as pressing Esc. Without
    // this the user has to manually toggle off; the click that deleted is
    // also a clear "I'm done with this spacer" signal.
    setMode('view')
  }, [spacersData, updateSpacersData, spacerDeleteAnnotations, canvasData, headingPositions, currentPaddingLeft, updateAnnotationData, snapsData])

  // Re-anchor items below a newly added spacer to the spacer's end-sentinel.
  // Without this, items stay tied to the parent section's heading (which
  // doesn't move when the spacer grows), so they don't follow subsequent
  // height changes. We update item.y/top by +H so the items also visually
  // shift down by the spacer's height at the moment of insertion (matching
  // the content reflow). The reverse on spacer-remove (re-anchor to the
  // previous divider above, shift -H) lives in handleRemoveSpacer.
  useEffect(() => {
    const pending = pendingSpacerReassignmentRef.current
    if (!pending) return
    const NT = headingPositions.find(h => h.sectionId === `spacer-${pending.id}`)?.offsetY
    const NE = headingPositions.find(h => h.sectionId === `spacer-${pending.id}-end`)?.offsetY
    if (NT === undefined || NE === undefined) return  // wait for inject + recalc

    // Use the LIVE measured height (NE − NT) rather than the literal pending.height.
    // The spacer DOM's box-sizing, margin-collapse with neighbors, and sub-pixel
    // rounding all mean the actual layout shift can deviate from the requested
    // 80 px by a fraction. Stored y must shift by exactly the layout delta for
    // the SVG re-render to land on the same screen pixel as before; otherwise
    // pre-existing strokes show a tiny add-time misalignment that compounds
    // through resize → delete.
    const H = NE - NT
    pendingSpacerReassignmentRef.current = null

    // Decide reassignment per item: anchor must be above the new spacer's top,
    // and the item's current visual paper-Y must be below it.
    const visualY = (itemY: number, itemSectionOffsetY: number, itemSectionId: string): number | null => {
      const entry = headingPositions.find(h => h.sectionId === itemSectionId)
      if (!entry) return null
      return entry.offsetY + (itemY - itemSectionOffsetY)
    }
    const shouldReassign = (itemY: number, itemSectionOffsetY: number, itemSectionId: string): boolean => {
      const entry = headingPositions.find(h => h.sectionId === itemSectionId)
      if (!entry) return false
      if (entry.offsetY >= NT) return false
      const visual = visualY(itemY, itemSectionOffsetY, itemSectionId)
      return visual !== null && visual > NT
    }

    // Strokes (canvasData)
    if (canvasData) {
      try {
        const strokes = JSON.parse(canvasData) as StrokeData[]
        let changed = false
        const next = strokes.map(stroke => {
          const refY = stroke.points[0]?.y ?? stroke.avgY ?? 0
          if (!shouldReassign(refY, stroke.sectionOffsetY, stroke.sectionId)) return stroke
          changed = true
          return {
            ...stroke,
            sectionId: `spacer-${pending.id}-end`,
            sectionOffsetY: NE,
            points: stroke.points.map(p => ({ ...p, y: p.y + H })),
            avgY: stroke.avgY !== undefined ? stroke.avgY + H : stroke.avgY,
          }
        })
        if (changed) setCanvasData(JSON.stringify(next))
      } catch { /* ignore */ }
    }

    // Snaps
    const currentSnaps = snapsData?.snaps || []
    let snapsChanged = false
    const nextSnaps = currentSnaps.map(snap => {
      if (snap.sectionId === undefined || snap.sectionOffsetY === undefined) return snap
      if (!shouldReassign(snap.top, snap.sectionOffsetY, snap.sectionId)) return snap
      snapsChanged = true
      return {
        ...snap,
        sectionId: `spacer-${pending.id}-end`,
        sectionOffsetY: NE,
        top: snap.top + H,
      }
    })
    if (snapsChanged) updateSnapsData({ snaps: nextSnaps })

    // Sticky notes are managed by sticky-notes-layer (its own data hook).
    // Fire a window event so it can run the same reassignment on its own state.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('eduskript:reanchor-below-spacer', {
        detail: { spacerId: pending.id, spacerTop: NT, spacerEndY: NE, height: H },
      }))
    }
  }, [headingPositions, canvasData, snapsData, updateSnapsData])

  // Compute all gap Y positions between block children (for preview lines)
  // Returns array of { index, y } for each gap
  const [spacerGapPositions, setSpacerGapPositions] = useState<Array<{ index: number; y: number }>>([])

  useEffect(() => {
    if (mode !== 'spacer') {
      setSpacerGapPositions([])
      return
    }

    const blockChildren = getBlockChildren()
    if (blockChildren.length === 0) {
      setSpacerGapPositions([])
      return
    }

    const paperEl = document.getElementById('paper')
    if (!paperEl) return
    const paperRect = paperEl.getBoundingClientRect()
    const scale = (paperRect.width / paperEl.offsetWidth) || 1

    const gaps: Array<{ index: number; y: number }> = []
    for (let i = 0; i < blockChildren.length; i++) {
      const rect = blockChildren[i].getBoundingClientRect()
      const bottomY = (rect.bottom - paperRect.top) / scale
      gaps.push({ index: i, y: bottomY })
    }
    setSpacerGapPositions(gaps)
  }, [mode, children, getBlockChildren, allSpacersToInject])

  // Find nearest gap index from a client Y position
  const findNearestGap = useCallback((clientY: number): number | null => {
    const paperEl = document.getElementById('paper')
    if (!paperEl || spacerGapPositions.length === 0) return null
    const paperRect = paperEl.getBoundingClientRect()
    const scale = (paperRect.width / paperEl.offsetWidth) || 1
    const y = (clientY - paperRect.top) / scale

    let bestIndex = 0
    let bestDist = Infinity

    for (const gap of spacerGapPositions) {
      const dist = Math.abs(y - gap.y)
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = gap.index
      }
    }

    return bestIndex
  }, [spacerGapPositions])

  // Click/tap-to-place: find the nearest gap and insert a spacer
  // Uses PointerEvent to support both touch and stylus input
  const handleSpacerPlacement = useCallback((e: React.PointerEvent) => {
    if (mode !== 'spacer') return
    // Don't place during an active resize drag
    if (spacerResizing) return
    const index = findNearestGap(e.clientY)
    if (index === null) return

    handleAddSpacer(index)
    setSpacerInsertIndex(null)
  }, [mode, handleAddSpacer, findNearestGap, spacerResizing])

  // Hover/move: highlight nearest gap
  const handleSpacerHover = useCallback((e: React.PointerEvent) => {
    if (mode !== 'spacer' || spacerResizing) return
    setSpacerInsertIndex(findNearestGap(e.clientY))
  }, [mode, findNearestGap, spacerResizing])

  // Ref for the save function that accepts options (used when switching targets)
  const performSaveWithOptionsRef = useRef<((options?: SyncedUserDataOptions) => Promise<void>) | null>(null)

  // Function to perform the actual save with optional targeting override
  // IMPORTANT: Uses refs instead of state to avoid stale closure issues when called from setTimeout
  const performSaveWithOptions = useCallback(async (overrideOptions?: SyncedUserDataOptions) => {
    const effectiveOptions = overrideOptions ?? syncOptions
    log('performSaveWithOptions called', {
      viewMode,
      syncOptions,
      overrideOptions,
      effectiveOptions,
      targetingKey
    })

    // Read from refs to get current values (avoids stale closure from setTimeout)
    const currentCanvasData = canvasDataRef.current
    const currentPageVersion = pageVersionRef.current
    let currentHeadingPositions = headingPositionsRef.current
    const paddingLeft = currentPaddingLeftRef.current

    // Don't save if we're in the middle of clearing
    if (isClearingRef.current) return

    if (!currentCanvasData || !currentPageVersion) return

    // If heading positions haven't been calculated yet, try to calculate them now
    // This can happen during fast refresh or when save is triggered before the 500ms delay
    if (currentHeadingPositions.length === 0 && contentRef.current) {
      const paperElement = document.getElementById('paper')
      if (paperElement) {
        const sectionElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
        const positions: HeadingPosition[] = []
        const paperRect = paperElement.getBoundingClientRect()
        // Divide by CSS transform scale to get unscaled coordinates (same as recalculateHeadingPositions)
        const scale = (paperRect.width / paperElement.offsetWidth) || 1
        const wrapperEl = paperElement.querySelector('.annotation-content-wrapper') as HTMLElement | null
        const originRect = wrapperEl ? wrapperEl.getBoundingClientRect() : paperRect

        sectionElements.forEach((element) => {
          const sectionId = element.getAttribute('data-section-id')
          const headingText = element.getAttribute('data-heading-text')
          const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

          if (sectionId) {
            const rect = element.getBoundingClientRect()
            const unscaledOffsetY = (rect.top - originRect.top) / scale

            // Add top reference point
            positions.push({
              sectionId,
              offsetY: unscaledOffsetY,
              headingText: headingText || ''
            })

            // For dynamic-height elements, also track bottom
            if (isDynamicHeight) {
              positions.push({
                sectionId: `${sectionId}-end`,
                offsetY: (rect.bottom - originRect.top) / scale,
                headingText: ''
              })
            }
          }
        })

        currentHeadingPositions = positions
        // Update the ref and state for future use
        headingPositionsRef.current = positions
        setHeadingPositions(positions)
      }
    }

    // Build the targeting override fields for updateAnnotationData. When the caller
    // passes overrideOptions (typically the layer-switch effect saving to the OLD
    // target), we must force-route the save to that target — even if it's personal
    // (targetType undefined). The hook distinguishes "no override" from "override to
    // personal" by checking `targetTypeOverride !== undefined`, so we coerce undefined
    // to null here. Without this, an override of personal-mode falls through and the
    // hook uses its current (post-switch) targetType, persisting strokes into the new
    // layer — i.e. the personal→class layer-transfer bug.
    const targetingOverride = overrideOptions
      ? {
          targetTypeOverride: overrideOptions.targetType ?? null,
          targetIdOverride: overrideOptions.targetId ?? null,
        }
      : {}

    try {
      // Parse canvas data to check if we have strokes
      const strokes = JSON.parse(currentCanvasData) as StrokeData[]

      if (strokes.length === 0) {
        // User erased every stroke — persist the empty state. Without this
        // the beforeunload-triggered performSave would silently drop and the
        // original strokes return on reload. We send the same "no annotations"
        // payload deleteAnnotationData() does, but route it through
        // updateAnnotationData so we can pass the targeting override (otherwise
        // the empty save would land on the hook's current target instead of the
        // one the caller intended).
        await updateAnnotationData(
          { canvasData: '', headingOffsets: {}, pageVersion: '' },
          { immediate: true, ...targetingOverride }
        )
        return
      }

      // Build heading offsets map. Saved alongside the strokes so reference layers
      // (other users' annotations) can reposition relative to their author's
      // layout. The active layer doesn't use this — its strokes are rendered via
      // section-anchored portals, which the browser layout carries directly.
      const headingOffsets = Object.fromEntries(
        currentHeadingPositions.map(h => [h.sectionId, h.offsetY])
      )

      const data: AnnotationData = {
        canvasData: currentCanvasData,
        headingOffsets,
        pageVersion: currentPageVersion,
        paddingLeft
      }

      setSaveState('saving')

      // Use immediate: true since we're already debouncing at component level
      await updateAnnotationData(data, {
        immediate: true,
        ...targetingOverride,
      })

      setSaveState('saved')

      // Reset to idle after showing success briefly
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')

      // Reset to idle after showing error briefly
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }, [updateAnnotationData, viewMode, syncOptions, targetingKey])

  // Keep ref in sync for use in effects that can't depend on the function directly
  // eslint-disable-next-line react-hooks/immutability -- Intentional: sync ref with callback for effects
  performSaveWithOptionsRef.current = performSaveWithOptions

  // performSave is just a wrapper that calls performSaveWithOptions without overrides
  const performSave = useCallback(async () => {
    await performSaveWithOptions()
  }, [performSaveWithOptions])

  // Keep ref in sync for use in effects that can't depend on performSave directly
  performSaveRef.current = performSave

  // Save on unmount (navigation away)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Perform immediate save on unmount
      performSave()
    }
  }, [performSave])

  // Save on page unload (refresh/close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Perform immediate save
      performSave()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [performSave])

  // Handle canvas annotation update with debounced save
  const handleCanvasUpdate = useCallback((data: string) => {
    log('handleCanvasUpdate called', {
      viewMode,
      selectedClassId: selectedClass?.id,
      selectedStudentId: selectedStudent?.id,
      dataLength: data.length
    })

    // Update local state immediately
    setCanvasData(data)

    // Check if there's actual data
    let hasData = false
    try {
      const strokes = JSON.parse(data) as StrokeData[]
      hasData = strokes && strokes.length > 0

      // First-stroke baseline-rebasing logic removed: with section-anchored portal
      // rendering, each stroke carries its own sectionOffsetY captured at draw
      // time, and renders inside its section element's natural layout position.
      // No global baseline ref to keep current, so layout shifts during a draw
      // gesture don't cause the post-commit visual jump that needed fixing.

      setHasAnnotations(hasData)

      // Reset clearing flag only when user actually draws something with content
      // Don't reset when canvas is cleared (empty data)
      if (hasData) {
        isClearingRef.current = false
        // Auto-unhide the layer when user draws on it
        ensureActiveLayerVisible()
      }

      // When trash button triggers this path it has already set isClearingRef
      // and will run its own deleteAnnotationData; skip to avoid a redundant
      // scheduled save. For the eraser-to-empty case isClearingRef is false,
      // so we fall through to the normal save path below — performSave routes
      // empty arrays to deleteAnnotationData itself.
      if (!hasData && isClearingRef.current) return

      // Update the class indicator when teacher draws on class broadcast
      if (isTeacher && viewMode === 'class-broadcast' && selectedClass) {
        setTeacherClasses(prev => prev.map(c =>
          c.id === selectedClass.id ? { ...c, hasAnnotationsOnPage: true } : c
        ))
      }
      // Update the student indicator when teacher draws on student feedback
      if (isTeacher && viewMode === 'student-view' && selectedStudent) {
        setClassStudents(prev => prev.map(s =>
          s.id === selectedStudent.id ? { ...s, hasAnnotationsOnPage: true } : s
        ))
      }
    } catch {
      return
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 2000)
  }, [performSave, ensureActiveLayerVisible, isTeacher, viewMode, selectedClass, selectedStudent])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      // Set flag to prevent any saves during/after clear operation
      isClearingRef.current = true

      // Cancel any pending save operations to prevent re-saving old data
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }

      // Clear state first to prevent re-initialization
      setCanvasData('')
      setHasAnnotations(false)
      setAnnotationVersionMismatch(false)
      setOrphanedStrokesCount(0)

      // Clear user data
      await deleteAnnotationData()

      // Also clear spacers, snaps, and sticky notes for the same target
      updateSpacersData({ spacers: [] })
      updateSnapsData({ snaps: [] })
      clearStickyNotes()

      // Clear canvas
      if (canvasRef.current) {
        canvasRef.current.clear()
      }
    } catch {
      // Ignore clearing errors
    }
  }, [deleteAnnotationData, setAnnotationVersionMismatch, updateSpacersData, updateSnapsData, clearStickyNotes])

  // Handle layer delete (only for active layer)
  const handleLayerDelete = useCallback((layerId: string) => {
    if (layerId === 'active') {
      handleClearAll()
    }
  }, [handleClearAll])

  // Handle clearing only personal annotations (for "My annotations" trash button)
  // This should NOT clear broadcast annotations, only the teacher's personal ones
  const handleClearPersonalAnnotations = useCallback(async () => {
    try {
      // Set flag to prevent any saves during/after clear operation
      isClearingRef.current = true

      // Cancel any pending save operations to prevent re-saving old data
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }

      // When NOT in broadcast mode, personal = current canvas, so clear UI state too
      if (!shouldLoadPersonalAsReference) {
        setCanvasData('')
        setHasAnnotations(false)
        setAnnotationVersionMismatch(false)
        setOrphanedStrokesCount(0)

        // Clear canvas
        if (canvasRef.current) {
          canvasRef.current.clear()
        }
      }

      await deletePersonalAnnotationData()

      // Also clear personal spacers, snaps, and sticky notes
      if (shouldLoadPersonalAsReference && updatePersonalSpacersData) {
        updatePersonalSpacersData({ spacers: [] })
      } else {
        updateSpacersData({ spacers: [] })
      }
      if (shouldLoadPersonalAsReference && updatePersonalSnapsData) {
        updatePersonalSnapsData({ snaps: [] })
      } else {
        updateSnapsData({ snaps: [] })
      }
      // clearStickyNotes() targets the ACTIVE layer's sticky notes, so only call
      // it when personal IS the active layer. In broadcast mode there's no separate
      // personal sticky-notes hook, so we can't clear them independently.
      if (!shouldLoadPersonalAsReference) {
        clearStickyNotes()
      }
    } catch (err) {
      console.error('Failed to clear personal annotations:', err)
    }
  }, [deletePersonalAnnotationData, shouldLoadPersonalAsReference, setAnnotationVersionMismatch, updatePersonalSpacersData, updateSpacersData, updatePersonalSnapsData, updateSnapsData, clearStickyNotes])

  // Register clear callback with global provider for SyncStatusButton
  useEffect(() => {
    setOnClearAnnotations(() => handleClearAll)
    return () => setOnClearAnnotations(null)
  }, [handleClearAll, setOnClearAnnotations])

  // Handle removal of orphaned strokes
  const handleRemoveOrphans = useCallback(() => {
    if (!canvasData) return

    try {
      const strokes: StrokeData[] = JSON.parse(canvasData)
      const filtered = strokes.filter(stroke => !stroke.sectionId.endsWith('-ORPHANED'))

      const newData = JSON.stringify(filtered)
      setCanvasData(newData)
      setOrphanedStrokesCount(0)

      // Update canvas
      if (canvasRef.current) {
        // The canvas will reload with filtered data via initialData prop
      }

      // Trigger immediate save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      performSave()
    } catch {
      // Ignore orphan removal errors
    }
  }, [canvasData, performSave])

  // Handle pen change
  const handlePenChange = useCallback((penIndex: number) => {
    setActivePen(penIndex)
  }, [])

  // Handle pen color change
  const handlePenColorChange = useCallback((penIndex: number, color: string) => {
    setPenColors(prev => {
      const newColors: [string, string, string] = [...prev] as [string, string, string]
      newColors[penIndex] = color
      return newColors
    })
  }, [])

  // Handle pen size change
  const handlePenSizeChange = useCallback((penIndex: number, size: number) => {
    setPenSizes(prev => {
      const newSizes: [number, number, number] = [...prev] as [number, number, number]
      newSizes[penIndex] = size
      return newSizes
    })
  }, [])

  // Handle snap capture - save directly with base64 URL
  // The sync service will persist to IndexedDB/PostgreSQL
  // S3 upload can be added later as background optimization
  const handleSnapCapture = useCallback((snap: Snap) => {
    setMode('view') // Return to view mode immediately

    // Anchor the snap to the section that currently contains its top edge so
    // it follows that section through layout reflow (spacers, callouts, etc).
    // Without this, the SnapData fields stay undefined and repositionSnaps
    // is a silent no-op — which is the snap-doesn't-follow-spacer bug.
    const sectionId = (headingPositions.length > 0 ? determineSectionFromY(snap.top, headingPositions) : null) ?? undefined
    const sectionOffsetY = sectionId
      ? headingPositions.find(h => h.sectionId === sectionId)?.offsetY
      : undefined

    const newSnap: Snap = {
      id: snap.id,
      name: snap.name,
      imageUrl: snap.imageUrl, // base64 data URL
      top: snap.top,
      left: snap.left,
      width: snap.width,
      height: snap.height,
      sectionId,
      sectionOffsetY,
    }
    const currentSnaps = snapsData?.snaps || []
    updateSnapsData({ snaps: [...currentSnaps, newSnap] })
  }, [snapsData, updateSnapsData, headingPositions])

  // Handle snap removal - just remove from synced data
  const handleRemoveSnap = useCallback((id: string) => {
    const currentSnaps = snapsData?.snaps || []

    // Remove from synced data
    updateSnapsData({ snaps: currentSnaps.filter(snap => snap.id !== id) })
  }, [snapsData, updateSnapsData])

  // Handle snap rename
  const handleRenameSnap = useCallback((id: string, newName: string) => {
    const currentSnaps = snapsData?.snaps || []
    updateSnapsData({
      snaps: currentSnaps.map(snap =>
        snap.id === id ? { ...snap, name: newName } : snap
      )
    })
  }, [snapsData, updateSnapsData])

  // Handle snap update (color, minimized, etc.)
  const handleUpdateSnap = useCallback((id: string, updates: Partial<Snap>) => {
    const currentSnaps = snapsData?.snaps || []
    // If the snap was moved vertically (drag), re-anchor it to whichever section
    // now contains its new top edge. Without this re-anchor a snap dragged out
    // of its old section stays tied to the wrong sectionOffsetY and snaps back
    // on the next reflow. Mirrors sticky-notes-layer.tsx's anchorForY on drag.
    const reAnchor = (() => {
      if (updates.top === undefined) return null
      if (headingPositions.length === 0) return null
      const sectionId = determineSectionFromY(updates.top, headingPositions) ?? undefined
      const sectionOffsetY = sectionId
        ? headingPositions.find(h => h.sectionId === sectionId)?.offsetY
        : undefined
      return { sectionId, sectionOffsetY }
    })()

    updateSnapsData({
      snaps: currentSnaps.map(snap =>
        snap.id === id ? { ...snap, ...updates, ...(reAnchor ?? {}) } : snap
      )
    })
  }, [snapsData, updateSnapsData, headingPositions])

  // Handle snap reorder
  const handleReorderSnaps = useCallback((reorderedSnaps: Snap[]) => {
    updateSnapsData({ snaps: reorderedSnaps })
  }, [updateSnapsData])

  // Handle stylus detection
  const handleStylusDetected = useCallback(() => {
    // Update pen timestamp for priority system
    lastPenEventTimeRef.current = Date.now()

    if (!stylusModeActive) {
      setStylusModeActive(true)
    }
    // Switch to draw mode only if in view mode (preserve erase mode)
    if (mode === 'view') {
      setMode('draw')
    }
  }, [stylusModeActive, mode])

  // Document-level stylus detection when not in stylus mode
  useEffect(() => {
    if (stylusModeActive) return // Only listen when stylus mode is not active

    const handleDocumentPointer = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        lastPenEventTimeRef.current = Date.now()
        handleStylusDetected()
      }
    }

    // Listen for both hover (pointermove) and touch (pointerdown)
    document.addEventListener('pointermove', handleDocumentPointer)
    document.addEventListener('pointerdown', handleDocumentPointer)
    return () => {
      document.removeEventListener('pointermove', handleDocumentPointer)
      document.removeEventListener('pointerdown', handleDocumentPointer)
    }
  }, [stylusModeActive, handleStylusDetected])

  // Keep updating pen timestamp while drawing (stylus mode active)
  // This is handled directly in the canvas event handlers for better performance
  // Removed document-level listener to avoid overhead on every pointermove event

  // Document-level mouse detection when stylus mode is active
  useEffect(() => {
    if (!stylusModeActive) return // Only listen when stylus mode IS active

    let hasSwitched = false

    const handleDocumentMouseMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        const now = Date.now()
        const timeSinceLastPen = now - lastPenEventTimeRef.current

        // Pen has priority - ignore mouse events for 500ms after last pen event
        // (increased from 200ms for better iPad Safari compatibility)
        if (timeSinceLastPen < 500) {
          return
        }

        // Pen cooldown expired - allow mouse to switch mode (only once)
        if (!hasSwitched) {
          hasSwitched = true
          setStylusModeActive(false)
          setMode('view')
        }
      }
    }

    // Listen for mouse movement
    document.addEventListener('pointermove', handleDocumentMouseMove)
    return () => {
      document.removeEventListener('pointermove', handleDocumentMouseMove)
    }
  }, [stylusModeActive])

  // Handle non-stylus input in stylus mode (switch to view mode and deactivate stylus mode)
  const handleNonStylusInput = useCallback(() => {
    if (stylusModeActive && mode !== 'view') {
      setMode('view')
      setStylusModeActive(false)
    }
  }, [stylusModeActive, mode])

  // CSS transform: scale() doesn't affect layout, so the scroll container has no idea
  // the content grew. This helper injects an invisible spacer sibling of <main> sized
  // to the scaled-paper dimensions; the scroll container picks it up and offers a
  // correctly-sized scrollable area natively.
  //
  // We also override main's max-width: at narrow viewports `main:has(.paper-responsive)`
  // gets `max-width: 100vw` (globals.css) to prevent horizontal overflow under normal
  // layout — but when zoomed we *want* horizontal overflow for scrolling, so we lift
  // the cap until zoom returns to 1.
  //
  // #scroll-container is `position: relative` declaratively (see public/layout.tsx),
  // which is what makes this absolute spacer place correctly.
  const updateZoomSpacer = useCallback((zoomLevel: number) => {
    const container = scrollContainerRef.current
    const main = mainRef.current
    if (!container || !main) return

    let spacer = document.getElementById('zoom-spacer')

    if (zoomLevel < 1) {
      // Zoomed OUT: main's CSS transform shrinks the visual but leaves the
      // layout box at its full natural height, so the scroll container offers
      // empty scroll all the way down to where the unzoomed paper would have
      // ended. Compensate with a negative margin-bottom equal to the
      // "missing" visual space (= layout height × (1 − zoom)). The scroll
      // container's scrollable area then matches the visible paper bottom.
      // Symmetrically for width via marginRight.
      spacer?.remove()
      main.style.maxWidth = ''
      const dy = main.scrollHeight * (1 - zoomLevel)
      const dx = main.scrollWidth * (1 - zoomLevel)
      main.style.marginBottom = `-${dy}px`
      main.style.marginRight = `-${dx}px`
      return
    }

    // Reset the zoom-out compensation now that we're at >= 1×.
    main.style.marginBottom = ''
    main.style.marginRight = ''

    if (zoomLevel === 1) {
      spacer?.remove()
      main.style.maxWidth = ''
      return
    }

    if (!spacer) {
      spacer = document.createElement('div')
      spacer.id = 'zoom-spacer'
      spacer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none'
      spacer.ariaHidden = 'true'
      container.appendChild(spacer)
    }

    spacer.style.width = `${main.scrollWidth * zoomLevel}px`
    spacer.style.height = `${main.scrollHeight * zoomLevel}px`

    main.style.maxWidth = 'none'
  }, [])

  // Helper function to apply zoom transform using RAF (no re-renders)
  // Uses CSS transform: scale() which is paint/composite-only — no layout reflow.
  const applyZoom = useCallback((newZoom: number, focalX?: number, focalY?: number) => {
    // Use renderedZoomRef (actual DOM state) not zoomRef (which may already be ahead of the DOM
    // due to rapid wheel events cancelling each other's RAFs before they execute).
    const oldZoom = renderedZoomRef.current
    zoomRef.current = newZoom

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    // Apply transform in next frame
    rafIdRef.current = requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
        renderedZoomRef.current = newZoom
      }

      updateZoomSpacer(newZoom)

      // Adjust scroll position to keep focal point stationary
      if (scrollContainerRef.current && focalX !== undefined && focalY !== undefined) {
        const container = scrollContainerRef.current
        const containerRect = container.getBoundingClientRect()

        // Convert client coordinates to container-relative coordinates
        const relativeX = focalX - containerRect.left
        const relativeY = focalY - containerRect.top

        // Find the content point under the focal point (in unscaled coordinates)
        const contentX = (relativeX + container.scrollLeft) / oldZoom
        const contentY = (relativeY + container.scrollTop) / oldZoom

        // Calculate new scroll so the same content point stays under the focal point
        const newScrollX = contentX * newZoom - relativeX
        const newScrollY = contentY * newZoom - relativeY

        container.scrollLeft = Math.max(0, newScrollX)
        container.scrollTop = Math.max(0, newScrollY)
      }

      rafIdRef.current = null
    })
  }, [updateZoomSpacer])

  // Handle zoom reset
  const handleResetZoom = useCallback(() => {
    applyZoom(1.0)
    setZoom(1.0)
    updateZoomSpacer(1.0)
    // Scroll to top
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [applyZoom, updateZoomSpacer])

  // Custom pinch-zoom handling (native scroll handles single-finger pan)
  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Track all touches
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Two touches - start pinch zoom and prevent browser zoom
    if (e.touches.length === 2) {
      e.preventDefault() // Prevent browser zoom

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      // Convert pinch center to container-relative coordinates
      const relativeX = centerX - containerRect.left
      const relativeY = centerY - containerRect.top

      // Calculate the content point under the initial pinch center (in unscaled coordinates)
      // This point should stay under the fingers throughout the gesture
      const contentX = (relativeX + container.scrollLeft) / zoomRef.current
      const contentY = (relativeY + container.scrollTop) / zoomRef.current

      initialPinchDistanceRef.current = distance
      initialPinchCenterRef.current = { x: centerX, y: centerY }
      initialContentPointRef.current = { x: contentX, y: contentY }
      initialZoomRef.current = zoomRef.current
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // Update touch positions
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Handle pinch zoom (2 fingers) - single-finger is handled by native scroll
    if (e.touches.length === 2 && initialPinchDistanceRef.current !== null && initialContentPointRef.current !== null) {
      e.preventDefault() // Prevent browser zoom during pinch

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const currentCenterX = (touch1.clientX + touch2.clientX) / 2
      const currentCenterY = (touch1.clientY + touch2.clientY) / 2

      // Calculate zoom factor relative to initial state
      const zoomFactor = currentDistance / initialPinchDistanceRef.current
      const newZoom = Math.max(0.5, Math.min(50, initialZoomRef.current * zoomFactor))

      // Convert current pinch center to container-relative coordinates
      const relativeX = currentCenterX - containerRect.left
      const relativeY = currentCenterY - containerRect.top

      // Calculate scroll position to keep the initial content point under the current pinch center
      // Formula: contentPoint * newZoom - relativePosition = newScroll
      const newScrollX = initialContentPointRef.current.x * newZoom - relativeX
      const newScrollY = initialContentPointRef.current.y * newZoom - relativeY

      // Apply transform and scroll synchronously (no RAF) for smooth gesture handling
      zoomRef.current = newZoom
      renderedZoomRef.current = newZoom
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
      }
      updateZoomSpacer(newZoom)
      container.scrollLeft = Math.max(0, newScrollX)
      container.scrollTop = Math.max(0, newScrollY)
    }
  }, [updateZoomSpacer])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Remove ended touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      touchesRef.current.delete(touch.identifier)
    }

    // Reset pinch state when less than 2 touches remain
    if (e.touches.length < 2) {
      // Update display zoom state when pinch gesture ends
      if (initialPinchDistanceRef.current !== null) {
        setZoom(zoomRef.current)
      }
      initialPinchDistanceRef.current = null
      initialPinchCenterRef.current = null
      initialContentPointRef.current = null
    }
  }, [])

  // Handle trackpad pinch zoom (Ctrl+wheel) and keyboard Ctrl+scroll
  // Trackpad pinch sends wheel events with ctrlKey=true WITHOUT a keydown event
  // So we must always listen for wheel events (non-passive) to intercept them
  const handleZoomWheel = useCallback((e: WheelEvent) => {
    // Only handle zoom when Ctrl/Cmd is pressed (includes trackpad pinch)
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()

    // Calculate zoom factor (negative deltaY means zoom in)
    // Normalize: scroll wheels send large deltaY (~100px), trackpads send small values
    // Use multiplicative scaling for consistent feel at any zoom level
    const factor = Math.pow(1.002, -e.deltaY)
    const newZoom = Math.max(0.5, Math.min(10, zoomRef.current * factor))

    // Apply zoom with focal point at cursor position
    applyZoom(newZoom, e.clientX, e.clientY)

    // Update display state for child components
    setZoom(newZoom)
  }, [applyZoom])

  // Attach wheel handler to capture trackpad pinch zoom
  // Must be non-passive to allow preventDefault on Ctrl+wheel
  useEffect(() => {
    document.addEventListener('wheel', handleZoomWheel, { passive: false })

    return () => {
      document.removeEventListener('wheel', handleZoomWheel)
    }
  }, [handleZoomWheel])

  // Find and store reference to parent <main> element, scroll container, and initialize transform
  useEffect(() => {
    if (!contentRef.current) return

    mainRef.current = contentRef.current.closest('main')
    scrollContainerRef.current = document.getElementById('scroll-container')

    if (!mainRef.current) return

    // Set transform properties once - scale only, no translate (scroll handles panning)
    mainRef.current.style.transformOrigin = 'top left'
    mainRef.current.style.transition = 'none'
    mainRef.current.style.transform = `scale(${zoomRef.current})`
    // Sync the zoom-spacer / margin-compensation to the new zoom level. This
    // matters on page navigation: <main> and #scroll-container live in the
    // layout above this component and persist across nav, so a #zoom-spacer
    // appended for the previous page's zoom > 1 stays in the DOM. When the
    // new page mounts at zoom 1, calling updateZoomSpacer here removes that
    // stale spacer (and clears any zoom-out marginBottom). Otherwise the
    // user lands on the new page with an extra page-height of empty scroll.
    updateZoomSpacer(zoomRef.current)
    return () => {
      // Clean up on unmount too, in case the next page renders without
      // AnnotationLayer (or under a different code path that doesn't sync).
      const spacer = document.getElementById('zoom-spacer')
      spacer?.remove()
      if (mainRef.current) {
        mainRef.current.style.marginBottom = ''
        mainRef.current.style.marginRight = ''
        mainRef.current.style.maxWidth = ''
      }
    }
    // updateZoomSpacer is referentially stable (useCallback with [] deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Set up event listeners for touch pinch zoom (wheel zoom is handled via Ctrl key listener)
  useEffect(() => {
    // Touch events for touchscreen pinch zoom
    document.addEventListener('touchstart', handleTouchStart, { passive: false })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: false })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return (
    <ZoomProvider zoomRef={zoomRef}>
      {/* Dev-only zoom readout. Portaled to body so the transform on <main> doesn't
          composite it (otherwise the indicator would scale with the page). */}
      {process.env.NODE_ENV === 'development' && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed bottom-4 right-4 bg-black/80 text-white text-xs font-mono px-2 py-1 rounded pointer-events-none"
          style={{ zIndex: 99999 }}
        >
          zoom {(zoom * 100).toFixed(1)}%
        </div>,
        document.body
      )}

      {/* Orphaned strokes warning banner */}
      {orphanedStrokesCount > 0 && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-400 dark:border-yellow-600 rounded-lg shadow-lg px-4 py-2 max-w-md">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              {orphanedStrokesCount} annotation{orphanedStrokesCount > 1 ? 's are' : ' is'} orphaned (original section{orphanedStrokesCount > 1 ? 's' : ''} deleted)
            </span>
            <button
              onClick={handleRemoveOrphans}
              className="ml-2 px-2 py-1 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded text-xs text-yellow-900 dark:text-yellow-100 whitespace-nowrap"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Content wrapper */}
      <div ref={contentRef} style={{ position: 'relative' }}>
        <LayerVisibilityProvider value={layerVisibilityContextValue}>
          <HeadingPositionsProvider positions={headingPositions}>
            {children}
          </HeadingPositionsProvider>
        </LayerVisibilityProvider>
      </div>

      {/* Canvas portaled directly into #paper - always matches paper bounds */}
      {paperElement && pageHeight > 0 && initialLoadComplete && createPortal(
        <div
          className={`annotation-content-wrapper ${!activeLayerVisible ? 'annotation-layer-hidden' : ''}`}
          style={{
            height: pageHeight,
            // Always capture events when in draw/erase mode or stylus mode (spacer mode bypasses canvas)
            pointerEvents: ((mode === 'draw' || mode === 'erase') || stylusModeActive) ? 'auto' : 'none',
            // CRITICAL: When pen is actively drawing, disable touch actions to prevent scroll
            // When pen is not drawing, allow touch scrolling
            touchAction: penActive ? 'none' : 'auto',
            zIndex: 40, // Above code editor buttons (z-30), below snap overlay (z-10000)
          }}
        >
          {/* Fallback layer: strokes whose sectionId doesn't resolve to a live DOM
              element (deleted section, or section unmounted mid-render). Rendered at
              their stored absolute paper coordinates, no transform — they sit where
              they were drawn until the user removes them via the orphans banner. */}
          {domOrphanedStrokes.length > 0 && (
            <AnnotationSvgLayer
              strokes={domOrphanedStrokes}
              width={paperWidth}
              height={pageHeight}
              markedForDeletion={eraserMarkedIds}
            />
          )}
          {/* Canvas: handles pointer events and renders in-progress stroke only.
              Committed strokes are displayed by the SVG layer above. */}
          <SimpleCanvas
            ref={canvasRef}
            width={paperWidth}
            height={pageHeight}
            mode={(mode === 'view' || mode === 'spacer') ? 'view' : (mode as DrawMode)}
            onUpdate={handleCanvasUpdate}
            onTelemetry={handleTelemetry}
            onDrawStart={ensureActiveLayerVisible}
            onEraserMarksChange={setEraserMarkedIds}
            initialData={canvasData}
            strokeColor={penColors[activePen]}
            strokeWidth={penSizes[activePen]}
            stylusModeActive={stylusModeActive}
            onStylusDetected={handleStylusDetected}
            onNonStylusInput={handleNonStylusInput}
            onPenStateChange={handlePenStateChange}
            zoom={zoom}
            headingPositions={headingPositions}
            svgHandlesDisplay
            scrollContainer={scrollContainerRef.current}
          />
          {/* Badge for active layer - shown on toolbar hover only */}
          {showActiveLayerBadge && hasAnnotations && (
            <LayerBadges
              canvasData={canvasData}
              layerId={activeLayerBadge.layerId}
              layerName={activeLayerBadge.layerName}
              layerColor={activeLayerBadge.layerColor}
              icon={activeLayerBadge.icon}
              zoom={zoom}
            />
          )}
        </div>,
        paperElement
      )}

      {/* Active layer's committed strokes — one small SVG per section, portaled
          into the section's `[data-section-id]` element. Browser layout carries
          each SVG with its host section, so spacers / callout toggles / code
          editor resizes / image loads reposition strokes for free, without any
          JS recalc. Strokes whose sectionId doesn't currently resolve to a live
          element are surfaced via onOrphansChange and rendered in the
          paper-anchored fallback above. */}
      {paperElement && pageHeight > 0 && initialLoadComplete && activeLayerVisible && (
        <SectionAnchoredStrokes
          strokes={parsedStrokes}
          paperWidth={paperWidth}
          paperHeight={pageHeight}
          paperPaddingLeft={currentPaddingLeft}
          markedForDeletion={eraserMarkedIds}
          onOrphansChange={setDomOrphanedStrokes}
          headingPositions={headingPositions}
        />
      )}

      {/* Reference annotation layers - read-only overlays.
          Each inner block gates on its own data (hasPersonalContent,
          teacherClassAnnotations.length, etc.), so an unpopulated layer
          stays unrendered. The previous global `initialLoadComplete` gate
          on top of those checks was the load-time bottleneck: it held back
          the SSR-supplied public layer until the personal-layer
          useSyncedUserData hooks resolved (~1 s on cold IndexedDB), even
          though the public block at the bottom of this list draws from
          props that are stable from first paint. */}
      {paperElement && pageHeight > 0 && (
        <>
          {/* All reference layers below use SectionAnchoredStrokes — strokes
              portal into [data-section-id] elements so the browser carries
              them with section reflow. Same deterministic positioning as the
              active drawing layer (and snaps + sticky notes). No JS
              measure-and-translate pass, no headingPositions race. */}

          {/* Teacher's personal annotations as reference (when broadcasting to class/student) */}
          {hasPersonalContent && isLayerVisible('personal') && (
            <SectionAnchoredStrokes
              strokes={parseStrokes(personalAnnotationData!.canvasData)}
              paperWidth={paperWidth}
              paperHeight={pageHeight}
              paperPaddingLeft={currentPaddingLeft}
              headingPositions={headingPositions}
              opacity={0.5}
              zIndex={37}
              badge={{
                layerId: 'personal',
                layerName: 'Personal',
                layerColor: 'blue',
                icon: <User className="w-3 h-3" />,
              }}
              showBadge={shouldShowReferenceBadge('personal')}
            />
          )}

          {/* Teacher's class broadcast as reference (when giving individual student feedback) */}
          {isTeacher && viewMode === 'student-view' && isLayerVisible('class-broadcast') && (() => {
            const broadcastCanvasData = classBroadcastData?.canvasData || classBroadcastCanvasRef.current
            if (!broadcastCanvasData || broadcastCanvasData === '[]') return null
            const layerId = `class-${selectedClass?.id}`
            return (
              <SectionAnchoredStrokes
                strokes={parseStrokes(broadcastCanvasData)}
                paperWidth={paperWidth}
                paperHeight={pageHeight}
                paperPaddingLeft={currentPaddingLeft}
                headingPositions={headingPositions}
                opacity={0.5}
                zIndex={37}
                badge={{
                  layerId,
                  layerName: selectedClass?.name || 'Class',
                  layerColor: 'blue',
                  icon: <Users className="w-3 h-3" />,
                }}
                showBadge={shouldShowReferenceBadge(layerId)}
              />
            )
          })()}

          {/* Student feedback as reference (when broadcasting to entire class but want to see last student's feedback) */}
          {isTeacher && viewMode === 'class-broadcast' && isLayerVisible('student-feedback') && (() => {
            const feedbackCanvasData = studentFeedbackData?.canvasData || studentFeedbackCanvasRef.current
            if (!feedbackCanvasData || feedbackCanvasData === '[]') return null
            return (
              <SectionAnchoredStrokes
                strokes={parseStrokes(feedbackCanvasData)}
                paperWidth={paperWidth}
                paperHeight={pageHeight}
                paperPaddingLeft={currentPaddingLeft}
                headingPositions={headingPositions}
                opacity={0.5}
                zIndex={37}
                badge={{
                  layerId: 'individual-feedback',
                  layerName: studentForFeedback ? formatStudentLabel(studentForFeedback) : 'Feedback',
                  layerColor: 'orange',
                  icon: <MessageSquare className="w-3 h-3" />,
                }}
                showBadge={shouldShowReferenceBadge('individual-feedback')}
              />
            )
          })()}

          {/* Student's own annotations (their personal work) - for teachers viewing student */}
          {isTeacher && studentForFeedback && isLayerVisible('student-work') && (() => {
            const studentAnnotations = studentWorkData?.annotations?.data as { canvasData?: string; headingOffsets?: Record<string, number>; paddingLeft?: number } | undefined
            const studentCanvasData = studentAnnotations?.canvasData
            if (!studentCanvasData || studentCanvasData === '[]') return null
            return (
              <SectionAnchoredStrokes
                strokes={parseStrokes(studentCanvasData)}
                paperWidth={paperWidth}
                paperHeight={pageHeight}
                paperPaddingLeft={currentPaddingLeft}
                headingPositions={headingPositions}
                opacity={0.85}
                zIndex={36}
                badge={{
                  layerId: 'student-work',
                  layerName: formatStudentLabel(studentForFeedback),
                  layerColor: 'purple',
                  icon: <User className="w-3 h-3" />,
                }}
                showBadge={shouldShowReferenceBadge('student-work')}
              />
            )
          })()}

          {/* Class broadcast annotations - for students */}
          {isStudent && teacherClassAnnotations.map((classAnnotation) => {
            const layerId = `class-${classAnnotation.classId}`
            if (!isLayerVisible(layerId)) return null
            const layerAnnotationData = classAnnotation.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null
            return (
              <SectionAnchoredStrokes
                key={classAnnotation.classId}
                strokes={parseStrokes(layerAnnotationData.canvasData)}
                paperWidth={paperWidth}
                paperHeight={pageHeight}
                paperPaddingLeft={currentPaddingLeft}
                headingPositions={headingPositions}
                badge={{
                  layerId,
                  layerName: classAnnotation.className || 'Class',
                  layerColor: 'blue',
                  icon: <Users className="w-3 h-3" />,
                }}
                showBadge={shouldShowReferenceBadge(layerId)}
              />
            )
          })}

          {/* Individual feedback annotations - for students */}
          {isStudent && teacherIndividualFeedback && isLayerVisible('individual') && (() => {
            const layerAnnotationData = teacherIndividualFeedback.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null
            return (
              <SectionAnchoredStrokes
                strokes={parseStrokes(layerAnnotationData.canvasData)}
                paperWidth={paperWidth}
                paperHeight={pageHeight}
                paperPaddingLeft={currentPaddingLeft}
                headingPositions={headingPositions}
                zIndex={39}
                badge={{
                  layerId: 'individual-feedback',
                  layerName: teacherIndividualFeedback.teacherName || 'Teacher',
                  layerColor: 'orange',
                  icon: <MessageSquare className="w-3 h-3" />,
                }}
                showBadge={shouldShowReferenceBadge('individual-feedback')}
              />
            )
          })()}

          {/* Public page annotations - visible to everyone (incl. anon).
              Don't show when user is actively editing page-broadcast (they see
              their own edits in the main layer). Synced data wins when the
              hook resolves; SSR-passed `publicAnnotations` carries first paint
              for anon and cold cache. Both paths portal per-section so anon
              and author land identically — no measure-and-transform race. */}
          {viewMode !== 'page-broadcast' && isLayerVisible('public') && (() => {
            const syncedData = pageBroadcastData?.canvasData
            if (syncedData && syncedData !== '[]') {
              return (
                <SectionAnchoredStrokes
                  strokes={parseStrokes(syncedData)}
                  paperWidth={paperWidth}
                  paperHeight={pageHeight}
                  paperPaddingLeft={currentPaddingLeft}
                  headingPositions={headingPositions}
                  zIndex={36}
                  badge={{
                    layerId: 'public',
                    layerName: 'Public',
                    layerColor: 'green',
                    icon: <Globe className="w-3 h-3" />,
                  }}
                  showBadge={shouldShowReferenceBadge('public')}
                />
              )
            }
            // SSR fallback: render each author's public annotations as a
            // separate SectionAnchoredStrokes (each may belong to a different
            // userId on multi-author skripts). Skip once synced data loaded.
            if (pageBroadcastData !== null) return null
            if (publicAnnotations.length === 0) return null
            return publicAnnotations.map((annotation, index) => {
              const layerAnnotationData = annotation.data as AnnotationData | null
              if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null
              return (
                <SectionAnchoredStrokes
                  key={`public-${annotation.userId}-${index}`}
                  strokes={parseStrokes(layerAnnotationData.canvasData)}
                  paperWidth={paperWidth}
                  paperHeight={pageHeight}
                  paperPaddingLeft={currentPaddingLeft}
                  headingPositions={headingPositions}
                  zIndex={36}
                  badge={{
                    layerId: `public-${annotation.userId}`,
                    layerName: 'Public',
                    layerColor: 'green',
                    icon: <Globe className="w-3 h-3" />,
                  }}
                  showBadge={shouldShowReferenceBadge('public')}
                />
              )
            })
          })()}
        </>
      )}

      {/* Toolbar */}
      <AnnotationToolbar
        mode={mode}
        onModeChange={setMode}
        onClear={handleClearAll}
        hasAnnotations={hasAnnotations || (spacersData?.spacers?.length ?? 0) > 0 || (snapsData?.snaps?.length ?? 0) > 0 || stickyNoteCount > 0}
        activePen={activePen}
        onPenChange={handlePenChange}
        penColors={penColors}
        onPenColorChange={handlePenColorChange}
        penSizes={penSizes}
        onPenSizeChange={handlePenSizeChange}
        onResetZoom={handleResetZoom}
        // Layer controls for students (broadcasted teacher annotations)
        layers={toolbarLayers}
        onLayerToggle={toggleLayerVisibility}
        onLayerDelete={handleLayerDelete}
        // Layer badges visibility (controlled by layers dropdown hover)
        showLayerBadges={showLayerBadges}
        onShowLayerBadgesChange={setShowLayerBadges}
        // My annotations controls (person icon - always controls personal annotations)
        myAnnotationsVisible={myAnnotationsVisible}
        myAnnotationsActive={myAnnotationsActive}
        onMyAnnotationsToggle={toggleMyAnnotationsVisibility}
        onMyAnnotationsDelete={handleClearPersonalAnnotations}
        // Broadcast controls for teachers
        isTeacher={isTeacher}
        // Page author broadcast controls (checked server-side via prop)
        isPageAuthor={isPageAuthor}
        broadcastToPage={broadcastToPage}
        onBroadcastToPageChange={setBroadcastToPage}
        hasPageBroadcastAnnotations={hasPageBroadcastAnnotations}
        onPageBroadcastDelete={deletePageBroadcastData}
        pageBroadcastVisible={pageBroadcastVisible}
        onPageBroadcastToggle={togglePageBroadcastVisibility}
        // Class broadcast controls
        classBroadcastVisible={classBroadcastVisible}
        onClassBroadcastToggle={toggleClassBroadcastVisibility}
        onClassBroadcastDelete={deleteClassBroadcastData}
        hasClassBroadcastAnnotations={hasClassBroadcastAnnotations}
        studentFeedbackVisible={studentFeedbackVisible}
        onStudentFeedbackToggle={toggleStudentFeedbackVisibility}
        onStudentFeedbackDelete={deleteStudentFeedbackData}
        hasStudentFeedbackAnnotations={hasStudentFeedbackAnnotations}
        classes={teacherClasses}
        selectedClass={selectedClass}
        onClassSelect={setSelectedClass}
        students={classStudents}
        selectedStudent={selectedStudent}
        onStudentSelect={setSelectedStudent}
        lastSelectedStudent={lastSelectedStudent}
        onClearLastSelectedStudent={() => setLastSelectedStudent(null)}
        spacerPattern={spacerPattern}
        onSpacerPatternChange={setSpacerPattern}
        spacerDeleteAnnotations={spacerDeleteAnnotations}
        onSpacerDeleteAnnotationsChange={handleSpacerDeleteAnnotationsChange}
        stickyNotePlacementMode={stickyNotePlacementMode}
        onStickyNotePlacementToggle={handleStickyNotePlacementToggle}
        stickyNoteCount={stickyNoteCount}
      />

      {/* Spacer click-to-place overlay - portaled into paper, captures pointer events (touch + stylus) */}
      {paperElement && mode === 'spacer' && createPortal(
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 42, // Above content, below toolbar
            cursor: 'crosshair',
            pointerEvents: 'auto',
            touchAction: 'none', // Prevent browser scroll on touch
          }}
          onPointerUp={handleSpacerPlacement}
          onPointerMove={handleSpacerHover}
          onPointerLeave={() => setSpacerInsertIndex(null)}
        >
          {/* All gap indicators - subtle lines at every possible insertion point.
              Hidden during spacer resize to avoid distraction. */}
          {!spacerResizing && spacerGapPositions.map((gap) => (
            <div
              key={gap.index}
              className="spacer-insertion-indicator"
              style={{
                top: gap.y,
                opacity: spacerInsertIndex === gap.index ? 1 : 0.25,
                height: spacerInsertIndex === gap.index ? 3 : 1,
              }}
            />
          ))}
        </div>,
        paperElement
      )}

      {/* Spacer controls - resize handles, floating panel (only when spacer tool active) */}
      {spacers.length > 0 && mode === 'spacer' && (
        <SpacersDisplay
          spacers={spacers}
          onUpdateSpacer={handleUpdateSpacer}
          onRemoveSpacer={handleRemoveSpacer}
          active={mode === 'spacer'}
          lastCreatedSpacerId={lastCreatedSpacerId}
          onLastCreatedConsumed={() => setLastCreatedSpacerId(null)}
          onResizingChange={setSpacerResizing}
        />
      )}

      {/* Paste-to-snap: listens for paste events and shows crop UI */}
      <PasteSnapHandler
        onCapture={handleSnapCapture}
        nextSnapNumber={snaps.length + 1}
        getInsertPosition={(snapWidth) => {
          const scrollTop = scrollContainerRef.current?.scrollTop ?? window.scrollY
          const viewportH = scrollContainerRef.current?.clientHeight ?? window.innerHeight
          // Vertical: centre of the current viewport in paper-logical coordinates
          const top = Math.round((scrollTop + viewportH / 2) / zoom)
          // Horizontal: 30px from the right edge of the paper
          const left = Math.max(0, Math.round(paperWidth - snapWidth - 30))
          return { top, left }
        }}
      />

      {/* Snaps display - portaled into paper (overflow:visible allows snaps to extend beyond) */}
      {paperElement && createPortal(
        <SnapsDisplay
          snaps={filteredSnaps}
          onRemoveSnap={handleRemoveSnap}
          onRenameSnap={handleRenameSnap}
          onUpdateSnap={handleUpdateSnap}
          onReorderSnaps={handleReorderSnaps}
          teacherSnaps={allTeacherSnaps}
          studentWorkSnaps={studentWorkSnapsData}
          snapOverrides={snapOverrides}
          onTeacherSnapOverride={handleTeacherSnapOverride}
          onStudentWorkSnapOverride={isTeacher ? handleStudentWorkSnapOverride : undefined}
          paperWidth={paperWidth}
          initialLoadComplete={initialLoadComplete}
          headingPositions={headingPositions}
        />,
        paperElement
      )}
    </ZoomProvider>
  )
}
