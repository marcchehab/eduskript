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
import { computeSectionTransforms, type SectionTransform } from '@/lib/annotations/svg-path'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import { useSyncedUserData, useUserDataContext, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import type { AnnotationData, StrokeTelemetry, TelemetryData } from '@/lib/userdata/types'
import type { SnapsData, SpacersData } from '@/lib/userdata/adapters'
import type { Spacer, SpacerPattern } from '@/types/spacer'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { getStrokeAvg } from '@/lib/annotations/stroke-grouping'
import { repositionSnaps } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useStickyNotesContext } from '@/contexts/sticky-notes-context'
import { LayerVisibilityProvider } from '@/contexts/layer-visibility-context'
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

/**
 * CSS-based animated reference layer
 * Uses a separate overlay canvas for new strokes with CSS opacity transition (GPU accelerated)
 * More performant than per-stroke canvas animation - no React re-renders during animation
 */
const AnimatedReferenceLayer = memo(function AnimatedReferenceLayer({
  canvasData,
  paperWidth,
  pageHeight,
  zoom,
  zIndex = 38, // Below main canvas (40), above code editor buttons (z-30)
  className = '',
  badge,
  showBadge = true,
  sectionTransforms,
}: {
  canvasData: string
  paperWidth: number
  pageHeight: number
  zoom: number
  zIndex?: number
  className?: string
  badge?: {
    layerId: string
    layerName: string
    layerColor: 'purple' | 'blue' | 'orange' | 'green'
    icon: React.ReactNode
  }
  showBadge?: boolean
  sectionTransforms?: Map<string, SectionTransform>
}) {
  // Parse strokes from data
  const allStrokes = useMemo(() => parseStrokes(canvasData), [canvasData])

  // Track which strokes are "established" (already animated in)
  const [establishedIds, setEstablishedIds] = useState<Set<string>>(new Set())
  const hasInitializedRef = useRef(false)
  const hasStabilizedRef = useRef(false)  // True after first render with newStrokes.length === 0
  const overlayRef = useRef<HTMLDivElement>(null)

  // Separate strokes into established vs new
  const { establishedStrokes, newStrokes } = useMemo(() => {
    const established: typeof allStrokes = []
    const newOnes: typeof allStrokes = []

    allStrokes.forEach(stroke => {
      if (establishedIds.has(stroke.id)) {
        established.push(stroke)
      } else {
        newOnes.push(stroke)
      }
    })

    return { establishedStrokes: established, newStrokes: newOnes }
  }, [allStrokes, establishedIds])

  // Handle initial load and sync establishedIds with current strokes
  useEffect(() => {
    const currentIds = new Set(allStrokes.map(s => s.id))

    if (!hasInitializedRef.current) {
      // First load - mark all current strokes as established (even if empty)
      hasInitializedRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: sync state with incoming prop
      setEstablishedIds(currentIds)
    } else {
      // Sync: update establishedIds to match current strokes
      // This handles both additions (via handleTransitionEnd) and deletions
      setEstablishedIds(prev => {
        const filtered = new Set([...prev].filter(id => currentIds.has(id)))
        // Only update if something was actually removed
        if (filtered.size !== prev.size) {
          return filtered
        }
        return prev
      })
    }
  }, [allStrokes])

  // When new strokes arrive (after initial load), trigger fade-in via DOM
  useEffect(() => {
    // Mark as stabilized once we've seen newStrokes become empty
    // (happens after initialization moves all strokes to established)
    if (newStrokes.length === 0) {
      hasStabilizedRef.current = true
      return
    }

    // Only animate if we've stabilized (prevents animation on initial mount)
    if (!hasStabilizedRef.current || !overlayRef.current) return

    // Double RAF ensures browser has painted at opacity 0 before triggering transition
    const el = overlayRef.current
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.opacity = '1'
      })
    })
  }, [newStrokes.length])

  // After animation completes, merge new strokes into established
  const handleTransitionEnd = useCallback(() => {
    if (newStrokes.length > 0) {
      setEstablishedIds(prev => {
        const next = new Set(prev)
        newStrokes.forEach(s => next.add(s.id))
        return next
      })
    }
  }, [newStrokes])

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        height: pageHeight,
        pointerEvents: 'none',
        zIndex,
      }}
    >
      {/* SVG layer with established strokes - React diffs paths naturally */}
      <AnnotationSvgLayer
        strokes={establishedStrokes}
        width={paperWidth}
        height={pageHeight}
        sectionTransforms={sectionTransforms}
      />
      {/* Overlay for new strokes with CSS fade-in */}
      {newStrokes.length > 0 && (
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: 0,
            transition: 'opacity 300ms ease-out',
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          <AnnotationSvgLayer
            strokes={newStrokes}
            width={paperWidth}
            height={pageHeight}
            sectionTransforms={sectionTransforms}
          />
        </div>
      )}
      {/* Floating badges to identify layer ownership - hidden by default, shown on toolbar hover */}
      {badge && showBadge && (
        <LayerBadges
          canvasData={canvasData}
          layerId={badge.layerId}
          layerName={badge.layerName}
          layerColor={badge.layerColor}
          icon={badge.icon}
          zoom={zoom}
        />
      )}
    </div>
  )
})

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
  const [classStudents, setClassStudents] = useState<Array<{ id: string; displayName: string; pseudonym?: string; hasAnnotationsOnPage?: boolean }>>([])

  // Track last selected student for quick-access and data loading when in class-broadcast mode
  const [lastSelectedStudent, setLastSelectedStudent] = useState<{ id: string; displayName: string; pseudonym?: string } | null>(null)
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
        const res = await fetch(`/api/classes/${selectedClass.id}/students?pageId=${encodeURIComponent(pageId)}`)
        if (res.ok) {
          const data = await res.json()
          setClassStudents(data.students?.map((s: { id: string; displayName: string; pseudonym?: string; hasAnnotationsOnPage?: boolean }) => ({
            id: s.id,
            displayName: s.displayName,
            pseudonym: s.pseudonym,
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

  // Load page-broadcast data for reference layer when not actively editing
  // This allows seeing saved page annotations even after switching modes
  const { data: pageBroadcastData, updateData: updatePageBroadcastData } = useSyncedUserData<AnnotationData>(
    pageId,
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
      return { layerId: 'individual-feedback', layerName: studentForFeedback.displayName || 'Feedback', layerColor: 'orange' as const, icon: <MessageSquare className="w-3 h-3" /> }
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

  // Delete page broadcast annotations (for page authors)
  const deletePageBroadcastData = useCallback(async () => {
    log('deletePageBroadcastData called', { viewMode })

    // Clear via the page-broadcast data hook
    if (updatePageBroadcastData) {
      await updatePageBroadcastData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
    }
    // Also clear spacers, snaps, and sticky notes for page broadcast
    updateSpacersData({ spacers: [] })
    updateSnapsData({ snaps: [] })
    clearStickyNotes()

    // If currently viewing page broadcast, also clear local state
    if (viewMode === 'page-broadcast') {
      setCanvasData('')
      setHasAnnotations(false)
      canvasRef.current?.clear()
    }
  }, [viewMode, updatePageBroadcastData, updateSpacersData, updateSnapsData, clearStickyNotes])

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
          ? `Feedback: ${selectedStudent.displayName || selectedStudent.pseudonym || 'Student'}`
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
  const [storedHeadingOffsets, setStoredHeadingOffsets] = useState<Record<string, number>>({})
  // Original offsets from annotation data — never overwritten by snap repositioning.
  // Used by computeSectionTransforms for accurate stroke repositioning.
  const originalHeadingOffsetsRef = useRef<Record<string, number>>({})
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
  // The public version takes precedence since it's the authoritative source
  const filteredSnaps = useMemo(() => {
    if (allTeacherSnaps.length === 0) return snaps
    // Create a set of public snap imageUrls for fast lookup
    const publicSnapUrls = new Set(allTeacherSnaps.map(s => s.imageUrl))
    // Filter out any local snaps that have the same imageUrl as a public snap
    return snaps.filter(snap => !publicSnapUrls.has(snap.imageUrl))
  }, [snaps, allTeacherSnaps])

  // Extract student work snaps for teachers viewing student's work
  const studentWorkSnapsData: StudentWorkSnap[] = useMemo(() => {
    if (!isTeacher || !studentForFeedback || !isLayerVisible('student-work')) return []

    const snapsData = studentWorkData?.snaps?.data as { snaps?: Snap[] } | null
    if (!snapsData?.snaps?.length) return []

    return snapsData.snaps.map(snap => ({
      ...snap,
      layerId: 'student-work',
      layerName: `${studentForFeedback.displayName || 'Student'}'s work`,
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
          originalHeadingOffsetsRef.current = offsets
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
    if (headingPositions.length > 0 && Object.keys(storedHeadingOffsets).length === 0
        && !hasLoadedAnnotationOffsets.current) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      originalHeadingOffsetsRef.current = currentOffsets
      setStoredHeadingOffsets(currentOffsets)
    }
  }, [headingPositions, storedHeadingOffsets])

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
    // getBoundingClientRect() returns scaled coordinates, but we need unscaled for canvas
    const paperRect = paperElement!.getBoundingClientRect()
    // Calculate scale from height ratio (same as width for uniform CSS transform scale)
    const scale = (paperRect.height / paperElement!.offsetHeight) || 1

    sectionElements.forEach((element) => {
      const sectionId = element.getAttribute('data-section-id')
      const headingText = element.getAttribute('data-heading-text')
      const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

      if (sectionId) {
        // Get the element's position relative to paper element
        // Divide by scale to convert from scaled (getBoundingClientRect) to unscaled (canvas) coordinates
        const rect = element.getBoundingClientRect()
        const unscaledOffsetY = (rect.top - paperRect.top) / scale

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
            offsetY: (rect.bottom - paperRect.top) / scale,
            headingText: ''
          })
        }
      }
    })

    log('recalcHeadingPositions:', positions.map(p => `${p.sectionId}@${Math.round(p.offsetY)}`).join(', '))
    setHeadingPositions(positions)
  }, [])

  // Track heading positions and page height (after markdown renders)
  useEffect(() => {
    if (!contentRef.current) return

    const timer = setTimeout(() => {
      recalculateHeadingPositions()
    }, 500) // Wait for markdown to render

    return () => clearTimeout(timer)
  }, [children, recalculateHeadingPositions]) // Re-run when children change (markdown re-renders)

  // Recalculate heading positions when teacher broadcast data arrives
  // This fixes a timing issue on iPad where page height may not be fully calculated yet
  useEffect(() => {
    if (classBroadcastCanvasDataRef.current) {
      recalculateHeadingPositions()
    }
  }, [classBroadcastData?.canvasData, recalculateHeadingPositions])

  // EXPERIMENTAL: Track heading positions on window resize for live repositioning
  // This allows real-time annotation repositioning when window width changes and text reflows
  useEffect(() => {
    let rafId: number | null = null
    let isScheduled = false

    const handleResize = () => {
      // Use requestAnimationFrame for smooth updates
      if (!isScheduled) {
        isScheduled = true
        rafId = requestAnimationFrame(() => {
          recalculateHeadingPositions()
          isScheduled = false
        })
      }
    }

    window.addEventListener('resize', handleResize)
    // Also listen for font size changes from font-size-controls
    window.addEventListener('eduskript:fontsize-change', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('eduskript:fontsize-change', handleResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [recalculateHeadingPositions])

  // Watch the entire content container for size changes.
  // Any element growing/shrinking (callouts, editors, images, datacube, etc.)
  // triggers recalculation so annotations reposition correctly.
  useEffect(() => {
    if (!contentRef.current) return

    let rafId: number | null = null
    let isScheduled = false

    const scheduleRecalculation = () => {
      if (!isScheduled) {
        isScheduled = true
        rafId = requestAnimationFrame(() => {
          recalculateHeadingPositions()
          isScheduled = false
        })
      }
    }

    const resizeObserver = new ResizeObserver(scheduleRecalculation)
    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
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
      el => !el.hasAttribute('data-spacer-id')
    )
  }, [getMarkdownContainer])

  // Inject spacer DOM elements between block children of .markdown-content
  useEffect(() => {
    const container = getMarkdownContainer()
    if (!container) return

    // Remove previously injected spacer elements
    container.querySelectorAll('[data-spacer-id]').forEach(el => el.remove())

    if (allSpacersToInject.length === 0) {
      recalculateHeadingPositions()
      return
    }

    // Sort spacers by afterBlockIndex descending so insertions don't shift indices
    const sorted = [...allSpacersToInject].sort((a, b) => b.afterBlockIndex - a.afterBlockIndex)

    for (const spacer of sorted) {
      // Re-query children excluding spacers since we just removed them all
      const currentChildren = Array.from(container.children).filter(
        el => !el.hasAttribute('data-spacer-id')
      )
      const clampedIndex = Math.min(spacer.afterBlockIndex, currentChildren.length - 1)
      if (clampedIndex < 0) continue

      const targetChild = currentChildren[clampedIndex]
      if (!targetChild) continue

      const spacerDiv = document.createElement('div')
      spacerDiv.setAttribute('data-spacer-id', spacer.id)
      spacerDiv.className = `spacer-element spacer-${spacer.pattern}`
      spacerDiv.style.height = `${spacer.height}px`

      targetChild.after(spacerDiv)
    }

    // Recalculate heading positions since content shifted
    recalculateHeadingPositions()
  }, [allSpacersToInject, children, recalculateHeadingPositions, getMarkdownContainer])

  // Track ID of the most recently created spacer so the floating panel auto-opens
  const [lastCreatedSpacerId, setLastCreatedSpacerId] = useState<string | null>(null)
  const [spacerResizing, setSpacerResizing] = useState(false)

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
    // Optionally delete annotations whose avgY falls within the spacer's vertical range
    if (spacerDeleteAnnotations && canvasData) {
      const spacerEl = document.querySelector(`[data-spacer-id="${id}"]`) as HTMLElement | null
      if (spacerEl) {
        const paperEl = document.getElementById('paper')
        if (paperEl) {
          const paperRect = paperEl.getBoundingClientRect()
          const scale = (paperRect.height / paperEl.offsetHeight) || 1
          const elRect = spacerEl.getBoundingClientRect()
          const spacerTop = (elRect.top - paperRect.top) / scale
          const spacerBottom = (elRect.bottom - paperRect.top) / scale

          try {
            const strokes = JSON.parse(canvasData) as StrokeData[]
            const filtered = strokes.filter(stroke => {
              const avg = getStrokeAvg(stroke)
              return avg.y < spacerTop || avg.y > spacerBottom
            })
            if (filtered.length !== strokes.length) {
              const newData = JSON.stringify(filtered)
              // Update canvas state — SimpleCanvas re-renders when initialData changes
              setCanvasData(newData)
              // Save filtered annotations
              const hasData = filtered.length > 0
              setHasAnnotations(hasData)
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
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    const current = spacersData?.spacers || []
    updateSpacersData({ spacers: current.filter(s => s.id !== id) })
  }, [spacersData, updateSpacersData, spacerDeleteAnnotations, canvasData, headingPositions, currentPaddingLeft, updateAnnotationData])

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
    const scale = (paperRect.height / paperEl.offsetHeight) || 1

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
    const scale = (paperRect.height / paperEl.offsetHeight) || 1
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
        const scale = (paperRect.height / paperElement.offsetHeight) || 1

        sectionElements.forEach((element) => {
          const sectionId = element.getAttribute('data-section-id')
          const headingText = element.getAttribute('data-heading-text')
          const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

          if (sectionId) {
            const rect = element.getBoundingClientRect()
            const unscaledOffsetY = (rect.top - paperRect.top) / scale

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
                offsetY: (rect.bottom - paperRect.top) / scale,
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

    try {
      // Parse canvas data to check if we have strokes
      const strokes = JSON.parse(currentCanvasData) as StrokeData[]

      if (strokes.length === 0) return

      // Build heading offsets map
      const headingOffsets = Object.fromEntries(
        currentHeadingPositions.map(h => [h.sectionId, h.offsetY])
      )

      // Update the original offsets baseline — after saving, the stored data
      // will have these offsets, so they become the new baseline for transforms.
      originalHeadingOffsetsRef.current = headingOffsets

      const data: AnnotationData = {
        canvasData: currentCanvasData,
        headingOffsets,
        pageVersion: currentPageVersion,
        paddingLeft
      }

      setSaveState('saving')

      // Use immediate: true since we're already debouncing at component level
      // Pass targeting overrides if provided (used when saving before switching targets)
      await updateAnnotationData(data, {
        immediate: true,
        targetTypeOverride: overrideOptions?.targetType,
        targetIdOverride: overrideOptions?.targetId,
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

      setHasAnnotations(hasData)

      // Reset clearing flag only when user actually draws something with content
      // Don't reset when canvas is cleared (empty data)
      if (hasData) {
        isClearingRef.current = false
        // Auto-unhide the layer when user draws on it
        ensureActiveLayerVisible()
      }

      if (!hasData) return

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

    // Save snap directly - imageUrl is already base64 from canvas capture
    const newSnap = {
      id: snap.id,
      name: snap.name,
      imageUrl: snap.imageUrl, // base64 data URL
      top: snap.top,
      left: snap.left,
      width: snap.width,
      height: snap.height,
    }
    const currentSnaps = snapsData?.snaps || []
    updateSnapsData({ snaps: [...currentSnaps, newSnap] })
  }, [snapsData, updateSnapsData])

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
    updateSnapsData({
      snaps: currentSnaps.map(snap =>
        snap.id === id ? { ...snap, ...updates } : snap
      )
    })
  }, [snapsData, updateSnapsData])

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

  // Helper function to apply zoom using CSS zoom (affects layout, no spacer needed)
  // With native scroll, we only need to handle zoom - scroll is handled by browser
  const applyZoom = useCallback((newZoom: number, focalX?: number, focalY?: number) => {
    // Use renderedZoomRef (actual DOM state) not zoomRef (which may already be ahead of the DOM
    // due to rapid wheel events cancelling each other's RAFs before they execute).
    const oldZoom = renderedZoomRef.current
    zoomRef.current = newZoom

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    // Apply zoom in next frame
    rafIdRef.current = requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.style.zoom = `${newZoom}`
        renderedZoomRef.current = newZoom
      }

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
  }, [])

  // Handle zoom reset
  const handleResetZoom = useCallback(() => {
    applyZoom(1.0)
    setZoom(1.0)
    // Scroll to top
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [applyZoom])

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

      // Apply zoom and scroll synchronously (no RAF) for smooth gesture handling
      zoomRef.current = newZoom
      renderedZoomRef.current = newZoom
      if (mainRef.current) {
        mainRef.current.style.zoom = `${newZoom}`
      }
      container.scrollLeft = Math.max(0, newScrollX)
      container.scrollTop = Math.max(0, newScrollY)
    }
  }, [])

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

    // Calculate zoom delta (negative deltaY means zoom in)
    const delta = -e.deltaY * 0.01
    const newZoom = Math.max(0.5, Math.min(50, zoomRef.current * (1 + delta)))

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

    // Set zoom once - CSS zoom affects layout, so scroll container dimensions update automatically
    mainRef.current.style.zoom = `${zoomRef.current}`
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
    <>
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
          {children}
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
          {/* SVG layer: committed strokes rendered as resolution-independent paths.
              Uses sectionTransforms (storedHeadingOffsets → current) for repositioning.
              This is compatible with existing data where repositionStrokes() already
              mutated points to match storedHeadingOffsets — the transform bridges
              from that baseline to the current layout. */}
          <AnnotationSvgLayer
            strokes={parsedStrokes}
            width={paperWidth}
            height={pageHeight}
            markedForDeletion={eraserMarkedIds}
            sectionTransforms={computeSectionTransforms(
              originalHeadingOffsetsRef.current,
              headingPositions,
              storedPaddingLeft,
              currentPaddingLeft
            )}
          />
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

      {/* Reference annotation layers - read-only overlays */}
      {/* Note: Don't condition on teacherAnnotationsLoading - use SWR pattern to keep showing */}
      {/* stale data while loading. Each layer checks its own data existence. */}
      {/* Wait for initialLoadComplete to prevent multiple redraws during initial page load */}
      {paperElement && pageHeight > 0 && initialLoadComplete && (
        <>
          {/* Teacher's personal annotations as reference (when broadcasting to class/student) */}
          {hasPersonalContent && isLayerVisible('personal') && (() => {
            const transforms = computeSectionTransforms(
              personalAnnotationData!.headingOffsets,
              headingPositions,
              personalAnnotationData!.paddingLeft,
              currentPaddingLeft
            )

            return createPortal(
              <div
                className="reference-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 37, // Below main canvas (40), above code editor buttons (z-30)
                  opacity: 0.5,
                }}
              >
                <AnnotationSvgLayer
                  strokes={parseStrokes(personalAnnotationData!.canvasData)}
                  width={paperWidth}
                  height={pageHeight}
                  sectionTransforms={transforms}
                />
                {/* Badge for personal reference layer */}
                {shouldShowReferenceBadge('personal') && (
                  <LayerBadges
                    canvasData={personalAnnotationData!.canvasData}
                    layerId="personal"
                    layerName="Personal"
                    layerColor="blue"
                    icon={<User className="w-3 h-3" />}
                    zoom={zoom}
                  />
                )}
              </div>,
              paperElement
            )
          })()}

          {/* Teacher's class broadcast as reference (when giving individual student feedback) */}
          {isTeacher && viewMode === 'student-view' && isLayerVisible('class-broadcast') && (() => {
            // Use classBroadcastData if available, otherwise fall back to stored canvas data
            const broadcastCanvasData = classBroadcastData?.canvasData || classBroadcastCanvasRef.current
            if (!broadcastCanvasData || broadcastCanvasData === '[]') return null

            const transforms = computeSectionTransforms(
              classBroadcastData?.headingOffsets,
              headingPositions,
              classBroadcastData?.paddingLeft,
              currentPaddingLeft
            )

            const layerId = `class-${selectedClass?.id}`

            return createPortal(
              <div
                className="reference-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 37, // Below main canvas (40), above code editor buttons (z-30)
                  opacity: 0.5,
                }}
              >
                <AnnotationSvgLayer
                  strokes={parseStrokes(broadcastCanvasData)}
                  width={paperWidth}
                  height={pageHeight}
                  sectionTransforms={transforms}
                />
                {/* Badge for class broadcast reference layer */}
                {shouldShowReferenceBadge(layerId) && (
                  <LayerBadges
                    canvasData={broadcastCanvasData}
                    layerId={layerId}
                    layerName={selectedClass?.name || 'Class'}
                    layerColor="blue"
                    icon={<Users className="w-3 h-3" />}
                    zoom={zoom}
                  />
                )}
              </div>,
              paperElement
            )
          })()}

          {/* Student feedback as reference (when broadcasting to entire class but want to see last student's feedback) */}
          {isTeacher && viewMode === 'class-broadcast' && isLayerVisible('student-feedback') && (() => {
            // Use hook data if available, otherwise use the fallback ref
            const feedbackCanvasData = studentFeedbackData?.canvasData || studentFeedbackCanvasRef.current
            if (!feedbackCanvasData || feedbackCanvasData === '[]') return null

            const transforms = computeSectionTransforms(
              studentFeedbackData?.headingOffsets,
              headingPositions,
              studentFeedbackData?.paddingLeft,
              currentPaddingLeft
            )

            return createPortal(
              <div
                className="reference-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 37, // Below main canvas (40), above code editor buttons (z-30)
                  opacity: 0.5,
                }}
              >
                <AnnotationSvgLayer
                  strokes={parseStrokes(feedbackCanvasData)}
                  width={paperWidth}
                  height={pageHeight}
                  sectionTransforms={transforms}
                />
                {/* Badge for student feedback reference layer */}
                {shouldShowReferenceBadge('individual-feedback') && (
                  <LayerBadges
                    canvasData={feedbackCanvasData}
                    layerId="individual-feedback"
                    layerName={studentForFeedback?.displayName || 'Feedback'}
                    layerColor="orange"
                    icon={<MessageSquare className="w-3 h-3" />}
                    zoom={zoom}
                  />
                )}
              </div>,
              paperElement
            )
          })()}

          {/* Student's own annotations (their personal work) - for teachers viewing student */}
          {isTeacher && studentForFeedback && isLayerVisible('student-work') && (() => {
            const studentAnnotations = studentWorkData?.annotations?.data as { canvasData?: string; headingOffsets?: Record<string, number>; paddingLeft?: number } | undefined
            const studentCanvasData = studentAnnotations?.canvasData
            if (!studentCanvasData || studentCanvasData === '[]') return null

            const transforms = computeSectionTransforms(
              studentAnnotations?.headingOffsets,
              headingPositions,
              studentAnnotations?.paddingLeft,
              currentPaddingLeft
            )

            return createPortal(
              <div
                className="reference-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 36, // Below other layers
                  opacity: 0.85, // Slightly reduced to show depth, but no color distortion
                }}
              >
                <AnnotationSvgLayer
                  strokes={parseStrokes(studentCanvasData)}
                  width={paperWidth}
                  height={pageHeight}
                  sectionTransforms={transforms}
                />
                {/* Floating badges to identify student work - shown on toolbar hover or while drawing */}
                {shouldShowReferenceBadge('student-work') && (
                  <LayerBadges
                    canvasData={studentCanvasData}
                    layerId="student-work"
                    layerName={studentForFeedback.displayName || 'Student'}
                    layerColor="purple"
                    icon={<User className="w-3 h-3" />}
                    zoom={zoom}
                  />
                )}
              </div>,
              paperElement
            )
          })()}

          {/* Class broadcast annotations - for students */}
          {isStudent && teacherClassAnnotations.map((classAnnotation) => {
            const layerId = `class-${classAnnotation.classId}`
            if (!isLayerVisible(layerId)) return null

            const layerAnnotationData = classAnnotation.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null

            const transforms = computeSectionTransforms(
              layerAnnotationData.headingOffsets,
              headingPositions,
              layerAnnotationData.paddingLeft,
              currentPaddingLeft
            )

            return (
              <div key={classAnnotation.classId}>
                {createPortal(
                  <AnimatedReferenceLayer
                    canvasData={layerAnnotationData.canvasData}
                    paperWidth={paperWidth}
                    pageHeight={pageHeight}
                    zoom={zoom}
                    sectionTransforms={transforms}
                    badge={{
                      layerId,
                      layerName: classAnnotation.className || 'Class',
                      layerColor: 'blue',
                      icon: <Users className="w-3 h-3" />
                    }}
                    showBadge={shouldShowReferenceBadge(layerId)}
                  />,
                  paperElement
                )}
              </div>
            )
          })}

          {/* Individual feedback annotations - for students */}
          {isStudent && teacherIndividualFeedback && isLayerVisible('individual') && (() => {
            const layerAnnotationData = teacherIndividualFeedback.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null

            const transforms = computeSectionTransforms(
              layerAnnotationData.headingOffsets,
              headingPositions,
              layerAnnotationData.paddingLeft,
              currentPaddingLeft
            )

            return createPortal(
              <AnimatedReferenceLayer
                canvasData={layerAnnotationData.canvasData}
                paperWidth={paperWidth}
                pageHeight={pageHeight}
                zoom={zoom}
                zIndex={39} // Below main canvas (40), above code editor buttons (z-30)
                sectionTransforms={transforms}
                badge={{
                  layerId: 'individual-feedback',
                  layerName: teacherIndividualFeedback.teacherName || 'Teacher',
                  layerColor: 'orange',
                  icon: <MessageSquare className="w-3 h-3" />
                }}
                showBadge={shouldShowReferenceBadge('individual-feedback')}
              />,
              paperElement
            )
          })()}

          {/* Public page annotations - visible to everyone */}
          {/* Don't show when user is actively editing page-broadcast (they see their own edits in the main layer) */}
          {/* Wait for initialLoadComplete to prevent double render (SSR fallback → synced data) */}
          {/* Wrapped in a single fade-in container to prevent flicker when switching data sources */}
          {viewMode !== 'page-broadcast' && isLayerVisible('public') && initialLoadComplete && createPortal(
            <div className="annotation-content-wrapper" style={{ zIndex: 36 }}>
              {(() => {
                // Use synced pageBroadcastData (updates dynamically) or fall back to server-passed publicAnnotations
                const syncedData = pageBroadcastData?.canvasData
                if (syncedData && syncedData !== '[]') {
                  const transforms = computeSectionTransforms(
                    pageBroadcastData?.headingOffsets ?? {},
                    headingPositions,
                    pageBroadcastData?.paddingLeft,
                    currentPaddingLeft
                  )

                  return (
                    <AnimatedReferenceLayer
                      canvasData={syncedData}
                      paperWidth={paperWidth}
                      pageHeight={pageHeight}
                      zoom={zoom}
                      zIndex={36} // Public annotations - lowest layer, above code editor buttons (z-30)
                      sectionTransforms={transforms}
                      badge={{
                        layerId: 'public',
                        layerName: 'Public',
                        layerColor: 'green',
                        icon: <Globe className="w-3 h-3" />
                      }}
                      showBadge={shouldShowReferenceBadge('public')}
                    />
                  )
                }

                // Fall back to server-passed publicAnnotations (for non-logged-in users or first load)
                // If synced hook has loaded (non-null), it's the source of truth — don't fall back to SSR
                if (pageBroadcastData !== null) return null
                if (publicAnnotations.length === 0) return null

                return publicAnnotations.map((annotation, index) => {
                  const layerAnnotationData = annotation.data as AnnotationData | null
                  if (!layerAnnotationData?.canvasData || layerAnnotationData.canvasData === '[]') return null

                  const transforms = computeSectionTransforms(
                    layerAnnotationData.headingOffsets,
                    headingPositions,
                    layerAnnotationData.paddingLeft,
                    currentPaddingLeft
                  )

                  return (
                    <AnimatedReferenceLayer
                      key={`public-${annotation.userId}-${index}`}
                      canvasData={layerAnnotationData.canvasData}
                      paperWidth={paperWidth}
                      pageHeight={pageHeight}
                      zoom={zoom}
                      zIndex={36} // Public annotations - lowest layer, above code editor buttons (z-30)
                      sectionTransforms={transforms}
                      badge={{
                        layerId: `public-${annotation.userId}`,
                        layerName: 'Public',
                        layerColor: 'green',
                        icon: <Globe className="w-3 h-3" />
                      }}
                      showBadge={shouldShowReferenceBadge('public')}
                    />
                  )
                })
              })()}
            </div>,
            paperElement
          )}
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
          zoom={zoom}
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
          zoom={zoom}
          paperWidth={paperWidth}
          initialLoadComplete={initialLoadComplete}
        />,
        paperElement
      )}
    </>
  )
}
