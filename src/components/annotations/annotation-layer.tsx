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
 * Each stroke / snap / sticky-note stores a `sectionId` + `sectionOffsetY`
 * captured at draw / placement time. At render time the artifact is portaled
 * into the matching `[data-section-id]` element and the browser's own layout
 * engine carries it through reflow — no JS reposition pass. See
 * `section-anchored-strokes.tsx` for the stroke renderer; snaps and sticky
 * notes use the same per-section createPortal pattern.
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
 * 7. **Undo/redo covers strokes only**: a stack of stroke-JSON states
 *    (lib/annotations/tap-gesture.ts), fed by handleCanvasUpdate. Spacers,
 *    snaps and sticky notes are not in it. It is emptied when the layer or
 *    page changes, on clear-all and when strokes are re-anchored by code.
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
import { createPortal, flushSync } from 'react-dom'
import { AlertTriangle, User, Users, MessageSquare, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode, type CanvasStroke } from './simple-canvas'
import { DEFAULT_ERASER_VARIANT, loadEraserVariant, saveEraserVariant, type EraserVariant } from '@/lib/annotations/eraser'
import { deleteStrokes, duplicateStrokes, moveStrokes, selectionBounds, type AnchorFor, type SelectableStroke } from '@/lib/annotations/selection'
import { AnnotationSelection } from './annotation-selection'
import { AnnotationSvgLayer } from './annotation-svg-layer'
import { reanchorLine } from '@/lib/annotations/line-edit'
import { SectionAnchoredStrokes } from './section-anchored-strokes'
import { AnnotationToolbar, formatStudentLabel, type AnnotationMode } from './annotation-toolbar'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'
import { useSyncedUserData, useUserDataContext, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import type { AnnotationData, StrokeTelemetry, TelemetryData } from '@/lib/userdata/types'
import type { SnapsData, SpacersData } from '@/lib/userdata/adapters'
import type { Spacer, SpacerPattern } from '@/types/spacer'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { getStrokeAvg } from '@/lib/annotations/stroke-grouping'
import { determineSectionFromY, liveSectionYShift, measureHeadingPositions, measureSectionOffsetY, repositionCanvasDataToLive } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useStickyNotesContext } from '@/contexts/sticky-notes-context'
import { LayerVisibilityProvider } from '@/contexts/layer-visibility-context'
import { HeadingPositionsProvider } from '@/contexts/heading-positions-context'
import { ZoomProvider } from '@/contexts/zoom-context'
import { useTeacherBroadcast } from '@/hooks/use-teacher-broadcast'
import { useDragPan } from '@/hooks/use-drag-pan'
import { useStudentWork } from '@/hooks/use-student-work'
import { parseStrokes, type AnimatedStroke } from '@/hooks/use-stroke-animation'
import { useSession } from 'next-auth/react'
import { useCurrentSite } from '@/contexts/current-site-context'
import { useSiteAccess } from '@/hooks/use-site-access'
import type { Snap } from '@/types/snap'
import { PasteSnapHandler } from './paste-snap-handler'
import { SnapsDisplay, type StudentWorkSnap, type SnapOverridesData, type SnapPositionOverride, type SnapPositionOverrides } from './snaps-display'
import { LayerBadges } from './layer-badges'
import { SpacersDisplay } from './spacers-display'
import { reanchorStrokesInPlace, reportableOrphans } from '@/lib/annotations/orphan-strokes'
import { blockChildren, computeSpacerAnchor, resolveSpacerBlockIndex } from '@/lib/annotations/spacer-anchor'
import { createLogger } from '@/lib/logger'
import { safeRandomUUID } from '@/lib/uuid'
import { clampZoom, pinchLeftDeadZone, pinchOrigin, pinchStep, recordEdit, stepHistory, tapTouchEnd, tapTouchMove, tapTouchStart, type StrokeHistory, type TapAction, type TapGesture, type TouchPoint, type PinchOrigin } from '@/lib/annotations/tap-gesture'
import { DEFAULT_PENS, loadPens, savePens, addPen, removePen, reorderPens, setPenColor, setPenSize, type PenConfig, type PenType } from '@/lib/annotations/pens'

const log = createLogger('annotations:layer')

// Pen takeover (first contact of a pen without hover draws, see the stylus
// detection effect): elements where the first pen tap keeps its native
// behaviour instead of starting a stroke.
const PEN_TAKEOVER_SKIP = [
  'a', 'button', 'input', 'textarea', 'select', 'label', 'summary', '[contenteditable]',
  '[role="button"]', '[role="slider"]', '.cm-editor', 'code-editor', 'iframe', 'plugin',
  '[data-sticky-note-id]', '[data-snap-id]',
].join(', ')

/** True when a pen pointerdown on `target` should start a stroke right away. */
function penTakeoverTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !target.closest('#paper')) return false
  // On the canvas itself (a pen picked in the toolbar) SimpleCanvas already draws.
  if (target.closest('.annotation-content-wrapper')) return false
  return !target.closest(PEN_TAKEOVER_SKIP)
}

/** Ctrl/⌘+wheel zoom: commit the `zoom` state this long after the last wheel event. */
const WHEEL_ZOOM_COMMIT_MS = 150
// Orphaned-strokes banner shows only after the orphan set was stable this long.
const ORPHAN_BANNER_DELAY_MS = 2000

/** Finger touches as points; Apple Pencil touches (touchType 'stylus') left out. */
function fingerPoints(list: TouchList): TouchPoint[] {
  const out: TouchPoint[] = []
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as Touch & { touchType?: string }
    if (t.touchType === 'stylus') continue
    out.push({ id: t.identifier, x: t.clientX, y: t.clientY })
  }
  return out
}

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

export function AnnotationLayer({ pageId, content, children, publicAnnotations: publicAnnotationsSeed = [], publicSnaps: publicSnapsSeed = [], isPageAuthor: isPageAuthorProp = false, isExamStudent = false }: AnnotationLayerProps) {
  const { sidebarWidth, viewportWidth, viewportHeight } = useLayout()
  const { data: session } = useSession()
  const { selectedClass, setSelectedClass, selectedStudent, setSelectedStudent, broadcastToPage, setBroadcastToPage, viewMode, isTeacher } = useTeacherClass()
  const { setAnnotationVersionMismatch, setOnClearAnnotations } = useUserDataContext()

  // "May write this page's PUBLIC layer" — under site scoping that is the
  // site's manager (personal owner / org owner+admin, src/lib/site-access.ts),
  // NOT the page author. Resolved client-side (ISR pages can't read the
  // session). The name is kept for the many downstream uses.
  const { siteId: currentSiteId } = useCurrentSite()
  const siteAccess = useSiteAccess(currentSiteId)
  const isPageAuthor = isPageAuthorProp || siteAccess.canManage

  // Gates the dev-only zoom-readout portal below. `typeof document !==
  // 'undefined'` is true during the client's hydration pass too (not just
  // after), so SSR renders nothing there while the client's first render
  // renders the portal — a hydration mismatch. Flipping this via an effect
  // means the first client render matches SSR (both skip it); the portal
  // appears one tick later, which is a normal post-hydration update, not a
  // mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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
        const res = await fetch(`/api/classes?pageId=${encodeURIComponent(pageId)}&siteId=${encodeURIComponent(currentSiteId ?? '')}`)
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
  }, [isTeacher, pageId, currentSiteId])

  // Public layers (page-broadcast annotations + snaps) for non-author viewers.
  // SSR prop seeds first paint; we always reconcile with the server on mount
  // and on visibility/focus, since revalidatePath() only clears the receiving
  // instance's ISR cache — with more than one app instance (Koyeb before
  // 2026-10-05; a deploy overlap now) a sibling can serve stale empty SSR.
  //
  // Page authors are excluded: they load the same data via the live-sync
  // pageBroadcastData hook (see ~line 692), which is authoritative for them.
  // Mirrors the sticky-notes-layer recovery path; both refresh paths can fire
  // independently because they hit different rows.
  const [publicAnnotations, setPublicAnnotations] = useState(publicAnnotationsSeed)
  const [publicSnaps, setPublicSnaps] = useState(publicSnapsSeed)
  useEffect(() => {
    if (isPageAuthor || !pageId) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await fetch(`/api/user-data/public/${encodeURIComponent(pageId)}?siteId=${encodeURIComponent(currentSiteId ?? '')}`)
        if (!res.ok || cancelled) return
        const json = await res.json() as { publicAnnotations?: PublicAnnotation[]; publicSnaps?: PublicSnap[] }
        if (cancelled) return
        // Server is authoritative — replace whatever the SSR seed (or a prior
        // refresh) put in state. Missing arrays default to empty.
        setPublicAnnotations(json.publicAnnotations ?? [])
        setPublicSnaps(json.publicSnaps ?? [])
      } catch {
        // Network errors are non-critical; SSR seed remains in place.
      }
    }
    refresh()

    // visibilitychange and focus both fire on a single tab switch, so an
    // unthrottled pair doubled the work on every alt-tab. Collapse them.
    let lastRefreshAt = Date.now()
    const REFRESH_MIN_INTERVAL_MS = 15_000
    const refreshThrottled = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return
      lastRefreshAt = Date.now()
      refresh()
    }

    document.addEventListener('visibilitychange', refreshThrottled)
    window.addEventListener('focus', refreshThrottled)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshThrottled)
      window.removeEventListener('focus', refreshThrottled)
    }
  }, [isPageAuthor, pageId, currentSiteId])

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
          fetch(`/api/classes/${selectedClass.id}/students?pageId=${encodeURIComponent(pageId)}&siteId=${encodeURIComponent(currentSiteId ?? '')}`),
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
  }, [isTeacher, selectedClass, pageId, currentSiteId])

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
    // Auto-show student feedback when ENTERING student-view (symmetric to the
    // auto-hide above). The auto-hide persists 'student-feedback': false to the
    // shared `annotation-layer-visibility` localStorage key on the way out to
    // class-broadcast. That key is global (not per-student / per-page), so
    // without this re-show the next student-view session — a different student,
    // another page, a later sitting — hydrates with the active feedback layer
    // stuck hidden: filteredSnaps returns [] and the active-stroke layer is
    // gated off, so the teacher's snaps/strokes appear only after a draw
    // re-triggers ensureActiveLayerVisible(). Fires on the mode transition
    // only (student→student keeps viewMode === 'student-view'), so a manual
    // hide within a grading session is preserved.
    if (isTeacher && prevViewModeRef.current !== 'student-view' && viewMode === 'student-view') {
      setLayerVisibility(prev => {
        if (prev['student-feedback'] === true) return prev
        const next = { ...prev, 'student-feedback': true }
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

  // Lasso selection on the active layer (see lib/annotations/selection.ts):
  // ids of the selected strokes, and the live drag delta while moving them.
  // Only exists in draw mode; cleared on any mode / audience switch.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [selectionDrag, setSelectionDrag] = useState<{ dx: number; dy: number } | null>(null)
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const clearSelection = useCallback(() => {
    setSelectedIds(null)
    setSelectionDrag(null)
  }, [])
  const handleLassoSelect = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids))
  }, [])
  // Reset on tool / audience switch: the selection belongs to the previous
  // tool + layer.
  useEffect(() => {
    clearSelection()
  }, [mode, viewMode, selectedClass?.id, selectedStudent?.id, clearSelection])

  // Esc ends a selection first; otherwise it returns to view mode from any
  // active tool (draw/erase/spacer).
  // Sticky-note placement has its own Esc handler in sticky-notes-layer.tsx;
  // both can fire harmlessly because each only acts when its mode is active.
  useEffect(() => {
    if (mode === 'view') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selectedIdsRef.current) clearSelection()
      else setMode('view')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, clearSelection])
  const [pageVersion, setPageVersion] = useState<string>('')
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [canvasData, setCanvasData] = useState<string>('')
  // Memoized parsed strokes for SVG rendering of committed strokes
  const parsedStrokes = useMemo(() => parseStrokes(canvasData), [canvasData])
  // Point eraser: while a gesture cuts, the canvas hands us its working stroke
  // list (RAF-throttled) and we render that instead of the committed data; on
  // pointer up it commits through handleCanvasUpdate and clears this. Strokes
  // the gesture did not touch are mapped back to their parsedStrokes objects,
  // so SectionAnchoredStrokes' per-object outline cache only builds the new
  // pieces. O(strokes) per preview frame.
  const [pointErasePreview, setPointErasePreview] = useState<CanvasStroke[] | null>(null)
  const parsedStrokesById = useMemo(() => new Map(parsedStrokes.map(s => [s.id, s])), [parsedStrokes])
  // Selection: drop ids that no longer exist (erased, remote update).
  const activeSelection = useMemo(() => {
    if (!selectedIds) return null
    const live = new Set<string>()
    for (const id of selectedIds) if (parsedStrokesById.has(id)) live.add(id)
    return live.size > 0 ? live : null
  }, [selectedIds, parsedStrokesById])
  const displayedStrokes = useMemo(() => {
    const base = pointErasePreview
      ? pointErasePreview.map(s => parsedStrokesById.get(s.id) ?? s)
      : parsedStrokes
    // Selection drag preview: selected strokes moved in stored coords, old
    // anchor kept (re-anchoring happens once, on release).
    return activeSelection && selectionDrag
      ? moveStrokes(base, activeSelection, selectionDrag.dx, selectionDrag.dy, () => 0, null)
      : base
  }, [pointErasePreview, parsedStrokes, parsedStrokesById, activeSelection, selectionDrag])
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
        // Site scoping (bughunt #6): the public layer is per (page, site).
        if (!currentSiteId) throw new Error('no site context')
        const currentRes = await fetch(
          `/api/user-data/sticky-notes/${encodeURIComponent(pageId)}?targetType=page&targetId=${encodeURIComponent(pageId)}&siteId=${encodeURIComponent(currentSiteId)}`,
        )
        const current = currentRes.ok ? await currentRes.json() : null
        const nextVersion = (current?.version ?? 0) + 1
        const res = await fetch('/api/user-data/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{
              siteId: currentSiteId,
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
        const result = res.ok ? await res.json().catch(() => null) : null
        if (!result || result.synced !== 1) throw new Error(`clear refused (${res.status})`)
      } catch (err) {
        log('sticky-notes page-broadcast clear failed', err)
      }
    }
  }, [
    viewMode,
    pageId,
    currentSiteId,
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

  // Stored strokes shifted to their current visual paper-y (the SVG layer
  // repositions committed strokes through reflow; the active-layer badge groups
  // off paper coords and would otherwise stick to the draw-time position). Only
  // consumed by LayerBadges below; never persisted.
  const liveBadgeCanvasData = useMemo(
    () => repositionCanvasDataToLive(canvasData, headingPositions),
    [canvasData, headingPositions],
  )

  // Refs to track latest values for use in callbacks (avoids stale closure issues)
  const canvasDataRef = useRef<string>('')

  // Undo/redo of strokes (header note 7). Counts drive the toolbar buttons.
  const historyRef = useRef<StrokeHistory>({ undo: [], redo: [] })
  const applyingHistoryRef = useRef(false)
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 })
  const syncHistoryCounts = useCallback(() => {
    const h = historyRef.current
    setHistoryCounts(prev => (prev.undo === h.undo.length && prev.redo === h.redo.length ? prev : { undo: h.undo.length, redo: h.redo.length }))
  }, [])
  const resetHistory = useCallback(() => {
    historyRef.current = { undo: [], redo: [] }
    syncHistoryCounts()
  }, [syncHistoryCounts])
  const [historyFlash, setHistoryFlash] = useState<string | null>(null)
  const historyFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyHistoryRef = useRef<((action: TapAction) => boolean) | null>(null)
  const pageVersionRef = useRef<string>('')
  const headingPositionsRef = useRef<HeadingPosition[]>([])
  const currentPaddingLeftRef = useRef<number>(0)

  // Assign the function now that refs are in scope
   
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
  // Active touch pinch (null = none). Re-based whenever the finger pair
  // changes; see pinchOrigin/pinchStep in lib/annotations/tap-gesture.ts.
  const pinchOriginRef = useRef<PinchOrigin | null>(null)
  // While a two-finger tap (undo) is possible, zoom starts only once the
  // fingers moved more than TAP_MAX_MOVE; until then this is false. Without a
  // tap gesture in progress the pinch is engaged from the first move.
  const pinchEngagedRef = useRef(false)
  // Ctrl/⌘+wheel: the `zoom` state is committed once the wheel burst pauses
  // (WHEEL_ZOOM_COMMIT_MS), not per event — each setZoom re-renders this layer.
  const wheelZoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Fractional scroll position applyZoom wrote last (see the WebKit note there).
  const wheelScrollRef = useRef<{ left: number; top: number } | null>(null)
  // Scroll container ref for zoom-scroll sync
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  // Display-only zoom state (updated on gesture end, not during gesture)
  const [zoom, setZoom] = useState(1.0)
  // Modular pens (add/remove/reorder), persisted to localStorage. DEFAULT_PENS
  // for SSR + initial render; loadPens() hydrates the saved set after mount.
  // See src/lib/annotations/pens.ts. Tracked by id so remove/reorder is stable.
  const [pens, setPens] = useState<PenConfig[]>(DEFAULT_PENS)
  const [activePenId, setActivePenId] = useState<string>(DEFAULT_PENS[0].id)
  const activePen = pens.find((p) => p.id === activePenId) ?? pens[0] ?? DEFAULT_PENS[0]

  // Highlighter pens draw ordinary strokes flagged tool:'highlighter' (own
  // layer below the pens, page-blended — see svg-path.ts / globals.css).
  const highlighterActive = mode === 'draw' && activePen.type === 'highlight'

  // Load saved pens after mount to avoid hydration mismatch.
  useEffect(() => {
    const loaded = loadPens()
    setPens(loaded)
    setActivePenId((prev) => (loaded.some((p) => p.id === prev) ? prev : loaded[0].id))
  }, [])
  const contentRef = useRef<HTMLDivElement>(null)
  // Canvas wrapper portaled into #paper: its top is paper-y 0 for strokes
  // (origin for live section measurements in selection edits).
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const [eraserMarkedIds, setEraserMarkedIds] = useState<Set<string>>(new Set())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // True between a local edit (debounced save scheduled) and the save that
  // persists it. Unload/unmount save only then: an unconditional save pushed
  // this tab's (possibly stale) copy to the server on every reload/close and
  // overwrote strokes another device had added meanwhile (equal versions are
  // not rejected by /api/user-data/sync).
  const unsavedChangesRef = useRef(false)
  const isClearingRef = useRef(false)
  const performSaveRef = useRef<(() => Promise<void>) | null>(null)
  const [pageHeight, setPageHeight] = useState(0)
  // Strokes whose sectionId currently doesn't resolve to a live DOM element.
  // These get rendered in a paper-anchored fallback overlay (no section to follow).
  // Updated by SectionAnchoredStrokes' onOrphansChange.
  const [domOrphanedStrokes, setDomOrphanedStrokes] = useState<AnimatedStroke[]>([])
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

  // Position overrides for teacher/public snaps (persisted via useSyncedUserData for all users).
  // Students can reposition class/individual feedback snaps, all users can reposition public snaps.
  // Types now live in snaps-display.ts (imported above) so the basedOn supersession shape stays
  // canonical across the override producer and consumer.
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
      // Small delay to ensure all data is processed before showing. The
      // trigger flag is set when the timer FIRES: setting it here let a
      // loading flag that flipped within the 50 ms clear the timer (cleanup)
      // while the early return above blocked every re-run, so the canvas
      // never mounted (pen selectable, nothing draws, until a lucky reload).
      const timer = setTimeout(() => {
        initialLoadTriggeredRef.current = true
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

  // Callback for when user moves/resizes a teacher or public snap.
  // `position` carries `basedOn` from the snap item so the render path can later
  // discard this override when the author's snap position no longer matches.
  const handleTeacherSnapOverride = useCallback((
    snapId: string,
    layerType: 'class' | 'individual' | 'public',
    position: SnapPositionOverride
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
    position: SnapPositionOverride
  ) => {
    setTeacherSnapOverrides(prev => ({
      ...prev,
      [snapId]: position
    }))
  }, [])

  // Pen priority: pen always wins, ignore other inputs for 200ms after last pen event
  const lastPenEventTimeRef = useRef<number>(0)
  // Last time the pen touched the screen (not hover): a multi-finger tap
  // during writing is a resting palm, not undo/redo.
  const lastPenContactRef = useRef<number>(0)
  const stylusModeActiveRef = useRef(false)
  // Multi-finger tap in progress (stylus mode), and when a gesture last had
  // two or more fingers down (keeps stylus mode on, see handleDocumentTouch).
  const tapRef = useRef<TapGesture | null>(null)
  const penTakeoverAtRef = useRef(0)
  const lastMultiTouchAtRef = useRef(0)

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
    stylusModeActiveRef.current = stylusModeActive
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
        if (e.type === 'pointerdown' || e.buttons) lastPenContactRef.current = Date.now()
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


  // Persist the pen set whenever it changes. Skip while `pens` is still the
  // module-constant default (initial render before loadPens swaps in a fresh
  // array) so we never clobber the stored set with mount-time defaults — this
  // is referential, so it's immune to the load/save effect ordering and
  // StrictMode's double-mount.
  useEffect(() => {
    if (pens === DEFAULT_PENS) return
    savePens(pens)
  }, [pens])


  // Generate page version hash
  useEffect(() => {
    generateContentHash(content).then(hash => {
      setPageVersion(hash)
      pageVersionRef.current = hash
    })
  }, [content])

  // Keep refs in sync with state (for use in callbacks to avoid stale closures)
  useEffect(() => {
     
    canvasDataRef.current = canvasData
    // '' = cleared, another layer or page loading: the history belonged to
    // the previous content.
    if (canvasData === '') resetHistory()
  }, [canvasData, resetHistory])

  // Every stroke id the canvas has held since it was last empty. A stroke id
  // in here that is no longer on the canvas was erased locally; the merge in
  // the load effect below must not bring it back.
  const heldStrokeIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (canvasData === '') heldStrokeIdsRef.current = new Set()
    for (const s of parsedStrokes) if (s.id) heldStrokeIdsRef.current.add(s.id)
  }, [canvasData, parsedStrokes])
  const lastMergedAnnotationDataRef = useRef<AnnotationData | null>(null)

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
  }, [targetingKey, syncOptions])

  // Load annotations from user data service
  // Runs when annotationData changes OR when canvas was cleared (canvasData becomes empty)
  useEffect(() => {
    // Don't reload if we're in the middle of clearing
    if (isClearingRef.current) return

    // Canvas already holds strokes (local IndexedDB copy shown first, or the
    // user is drawing) and a newer value arrives (server copy merged by the
    // sync engine, or our own write echoed back):
    //  - no unsaved local edit (unsavedChangesRef): take the delivered value
    //    as is. It is the store's current state, so strokes changed on the
    //    server under the same id (moved, re-anchored by a port) show too.
    //    Our own echoed write equals canvasData, a no-op.
    //  - unsaved local edit: keep the canvas, append only strokes whose id it
    //    never held (heldStrokeIdsRef), so local erasures stay erased. Server
    //    changes to strokes the canvas already has are not shown; the next
    //    save pushes the local version of those strokes.
    // O(n) parse per new annotationData object, skipped when unchanged.
    // Before this, a reload showed the local copy and ignored the server copy
    // until a second reload.
    if (canvasData) {
      if (!annotationData?.canvasData || lastMergedAnnotationDataRef.current === annotationData) return
      lastMergedAnnotationDataRef.current = annotationData
      if (!unsavedChangesRef.current) {
        if (annotationData.canvasData !== canvasData) {
          setCanvasData(annotationData.canvasData)
          resetHistory()
          log('took delivered annotation state (no unsaved local edits)')
        }
        return
      }
      try {
        const incoming: StrokeData[] = JSON.parse(annotationData.canvasData)
        const held = heldStrokeIdsRef.current
        const fresh = incoming.filter(s => s.id && !held.has(s.id))
        if (fresh.length === 0) return
        const local: StrokeData[] = JSON.parse(canvasData)
        setCanvasData(JSON.stringify([...local, ...fresh]))
        log('merged', fresh.length, 'stroke(s) delivered after the canvas loaded')
      } catch {
        // Ignore parse errors
      }
      return
    }

    if (annotationData && annotationData.canvasData) {
      try {
        const strokes: StrokeData[] = JSON.parse(annotationData.canvasData)

        if (strokes.length > 0) {
          setHasAnnotations(true)
          setCanvasData(annotationData.canvasData)
          log('loaded strokes sectionIds:', strokes.map(s => s.sectionId).join(', '))
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [annotationData, canvasData, targetingKey, resetHistory])

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

    // All [data-section-id] elements (headings, code blocks, callouts, …), plus
    // a synthetic `-end` for dynamic-height elements that lack a DOM sentinel.
    const positions = measureHeadingPositions(contentRef.current, originRect.top, scale)

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

  // Helper: content blocks of the markdown container, in afterBlockIndex
  // indexing (no spacers, no post-legacy sentinels; see spacer-anchor.ts).
  const getBlockChildren = useCallback(() => {
    const container = getMarkdownContainer()
    if (!container) return []
    return blockChildren(container)
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

    // Resolve every spacer's target block up front (spacer-anchor.ts: anchor
    // fields for new spacers, afterBlockIndex for legacy ones). Spacer
    // elements are excluded from `blocks`, so inserting one doesn't change the
    // others' targets. Insert order: target index descending, ties by
    // afterBlockIndex descending — for legacy spacers this is the same order
    // as the old sort by afterBlockIndex, so spacers sharing a block stack
    // exactly as before. (Existing spacers stay where they are.)
    const blocks = blockChildren(container)
    const sorted = allSpacersToInject
      .map(spacer => ({ spacer, target: resolveSpacerBlockIndex(blocks, spacer) }))
      .sort((a, b) => (b.target - a.target) || (b.spacer.afterBlockIndex - a.spacer.afterBlockIndex))

    let createdAnyNew = false
    for (const { spacer, target } of sorted) {
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

      // New spacer — create + insert after its resolved block.
      if (target < 0) continue
      const targetChild = blocks[target]
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
    const id = safeRandomUUID()
    const newSpacer: Spacer = {
      id,
      afterBlockIndex,
      height: 80,
      pattern: spacerPattern,
      // Stable placement for edited content (spacer-anchor.ts).
      ...computeSpacerAnchor(getBlockChildren(), afterBlockIndex),
    }
    setLastCreatedSpacerId(id)
    pendingSpacerReassignmentRef.current = { id, height: 80 }
    const current = spacersData?.spacers || []
    // immediate (also on update/remove): useSyncedUserData (provider.tsx)
    // queues the server sync from the IndexedDB record it reads right after
    // save(); with the default 1 s save debounce that record doesn't exist yet
    // for a page's first spacer, so the spacer never reached the server.
    updateSpacersData({ spacers: [...current, newSpacer] }, { immediate: true })
  }, [spacerPattern, spacersData, updateSpacersData, getBlockChildren])

  // Use ref to avoid stale closure — resize saves height, then pattern change
  // must read the latest spacersData (not the one captured before resize)
  const spacersDataRef = useRef(spacersData)
  spacersDataRef.current = spacersData

  const handleUpdateSpacer = useCallback((id: string, updates: Partial<Spacer>) => {
    const current = spacersDataRef.current?.spacers || []
    updateSpacersData({
      spacers: current.map(s => s.id === id ? { ...s, ...updates } : s)
    }, { immediate: true })
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
          resetHistory()
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
    updateSpacersData({ spacers: current.filter(s => s.id !== id) }, { immediate: true })
    // Exit spacer mode after a delete — same UX as pressing Esc. Without
    // this the user has to manually toggle off; the click that deleted is
    // also a clear "I'm done with this spacer" signal.
    setMode('view')
  }, [spacersData, updateSpacersData, spacerDeleteAnnotations, canvasData, headingPositions, currentPaddingLeft, updateAnnotationData, snapsData, updateSnapsData, resetHistory])

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
        if (changed) {
          // Persist through the normal 2 s autosave debounce (same timer as
          // handleCanvasUpdate). Until 2026-11-19 this only set state, so
          // IndexedDB/server kept the old anchors until beforeunload; a killed
          // tab brought the strokes back un-shifted under the spacer. Not an
          // immediate save: the spacer's own immediate sync is usually in
          // flight now, and sync-engine.ts sync() returns early while syncing
          // without rescheduling, which left this item queued.
          // performSave reads canvasDataRef.
          const newData = JSON.stringify(next)
          resetHistory()
          canvasDataRef.current = newData
          setCanvasData(newData)
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
          unsavedChangesRef.current = true
          saveTimeoutRef.current = setTimeout(() => { void performSaveRef.current?.() }, 2000)
        }
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
  }, [headingPositions, canvasData, snapsData, updateSnapsData, resetHistory])

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
    unsavedChangesRef.current = false

    // If heading positions haven't been calculated yet, try to calculate them now
    // This can happen during fast refresh or when save is triggered before the 500ms delay
    if (currentHeadingPositions.length === 0 && contentRef.current) {
      const paperElement = document.getElementById('paper')
      if (paperElement) {
        const paperRect = paperElement.getBoundingClientRect()
        // Divide by CSS transform scale to get unscaled coordinates (same as recalculateHeadingPositions)
        const scale = (paperRect.width / paperElement.offsetWidth) || 1
        const wrapperEl = paperElement.querySelector('.annotation-content-wrapper') as HTMLElement | null
        const originRect = wrapperEl ? wrapperEl.getBoundingClientRect() : paperRect

        const positions = measureHeadingPositions(contentRef.current, originRect.top, scale)

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
      // Perform immediate save on unmount, only if an edit is still unsaved
      if (unsavedChangesRef.current) performSave()
    }
  }, [performSave])

  // Save on page unload (refresh/close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Perform immediate save, only if an edit is still unsaved
      if (unsavedChangesRef.current) performSave()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [performSave])

  // Flush the 2s autosave debounce on demand. <ai-feedback> reads strokes from
  // the persisted record, so a student who writes and clicks within 2s would
  // otherwise be told nothing was written. Listeners push their save promise
  // into `detail.waitFor` so the caller can await the flush.
  // @see src/components/markdown/ai-feedback.tsx
  useEffect(() => {
    const onFlush = (e: Event) => {
      const detail = (e as CustomEvent<{ waitFor?: Promise<void>[] }>).detail
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      const done = performSave()
      detail?.waitFor?.push(done)
    }
    window.addEventListener('eduskript:flush-annotations', onFlush)
    return () => window.removeEventListener('eduskript:flush-annotations', onFlush)
  }, [performSave])

  // Handle canvas annotation update with debounced save
  const handleCanvasUpdate = useCallback((data: string) => {
    // Every local edit (stroke, eraser, selection, line edit) passes here;
    // undo/redo itself does not record.
    if (!applyingHistoryRef.current && !isClearingRef.current) {
      recordEdit(historyRef.current, canvasDataRef.current || '[]', data)
      syncHistoryCounts()
    }
    canvasDataRef.current = data
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
        // Lets <ai-feedback> drop a stale "nothing written" error.
        // @see src/components/markdown/ai-feedback.tsx
        window.dispatchEvent(new Event('eduskript:annotations-changed'))
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
    unsavedChangesRef.current = true
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 2000)
  }, [performSave, ensureActiveLayerVisible, isTeacher, viewMode, selectedClass, selectedStudent, syncHistoryCounts])

  /** Undo or redo one stroke edit. False = nothing to undo/redo. */
  const applyHistory = useCallback((action: TapAction): boolean => {
    const data = stepHistory(historyRef.current, action, canvasDataRef.current || '[]')
    if (data === null) return false
    clearSelection()
    applyingHistoryRef.current = true
    try {
      handleCanvasUpdate(data)
    } finally {
      applyingHistoryRef.current = false
    }
    syncHistoryCounts()
    setHistoryFlash(action === 'undo' ? 'Undone' : 'Redone')
    if (historyFlashTimerRef.current) clearTimeout(historyFlashTimerRef.current)
    historyFlashTimerRef.current = setTimeout(() => setHistoryFlash(null), 900)
    return true
  }, [handleCanvasUpdate, clearSelection, syncHistoryCounts])
  useEffect(() => {
    applyHistoryRef.current = applyHistory
  }, [applyHistory])

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y while annotating; not in inputs or
  // code editors, which have their own undo.
  useEffect(() => {
    if (mode === 'view' && !stylusModeActive) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const action: TapAction | null = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' && !e.shiftKey ? 'redo' : null
      if (!action) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || target.closest?.('input, textarea, select, .cm-editor'))) return
      if (applyHistory(action)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, stylusModeActive, applyHistory])

  /**
   * Commit a dragged straight line. Runs through the same handleCanvasUpdate
   * path a fresh stroke takes, so autosave, sync, undo and the teacher layers
   * all behave identically — the only extra work is re-anchoring, because a
   * line dragged into another section would otherwise keep the old sectionId
   * and jump back on the next reflow (the trap sticky notes solve in
   * `anchorForY`).
   */
  // Selection edits. Each reads the committed strokes, applies ONE pure edit
  // from lib/annotations/selection.ts and commits it through
  // handleCanvasUpdate — one save/sync per move, delete or duplicate.
  //
  // Re-anchoring (move, duplicate): strokes are rebased to where they are
  // painted now (stored y + live shift of their section, measured from the
  // DOM like the draw commit) and then anchored to the section under their
  // first point, with that section's live-measured top as sectionOffsetY.
  // Same anchoring as a freshly drawn stroke, so they stay put on reflow.
  const selectionAnchoring = useCallback(() => {
    const origin = canvasWrapperRef.current
    const hp = headingPositionsRef.current
    const measured = new Map<string, number | null>()
    const measure = (sid: string) => {
      if (!measured.has(sid)) measured.set(sid, measureSectionOffsetY(sid === 'unknown' ? 'paper-top' : sid, origin))
      return measured.get(sid)!
    }
    const shiftFor = (s: SelectableStroke) => {
      const live = s.sectionId ? measure(s.sectionId) : null
      return live !== null && s.sectionOffsetY !== undefined
        ? live - s.sectionOffsetY
        : liveSectionYShift(s.sectionId, s.sectionOffsetY, hp)
    }
    const anchorFor: AnchorFor = (points) => {
      const sectionId = determineSectionFromY(points[0].y, hp) || 'paper-top'
      const sectionOffsetY = measure(sectionId) ?? hp.find(h => h.sectionId === sectionId)?.offsetY ?? 0
      return { sectionId, sectionOffsetY }
    }
    return { shiftFor, anchorFor }
  }, [])

  const readCommittedStrokes = useCallback((): StrokeData[] | null => {
    try {
      return JSON.parse(canvasDataRef.current || '[]') as StrokeData[]
    } catch {
      return null
    }
  }, [])

  const handleSelectionMove = useCallback((dx: number, dy: number) => {
    const ids = selectedIdsRef.current
    const strokes = readCommittedStrokes()
    if (!ids || !strokes) return
    const { shiftFor, anchorFor } = selectionAnchoring()
    handleCanvasUpdate(JSON.stringify(moveStrokes(strokes, ids, dx, dy, shiftFor, anchorFor)))
  }, [readCommittedStrokes, selectionAnchoring, handleCanvasUpdate])

  const handleSelectionDelete = useCallback(() => {
    const ids = selectedIdsRef.current
    const strokes = readCommittedStrokes()
    if (!ids || !strokes) return
    clearSelection()
    handleCanvasUpdate(JSON.stringify(deleteStrokes(strokes, ids)))
  }, [readCommittedStrokes, clearSelection, handleCanvasUpdate])

  const handleSelectionDuplicate = useCallback(() => {
    const ids = selectedIdsRef.current
    const strokes = readCommittedStrokes()
    if (!ids || !strokes) return
    const { shiftFor, anchorFor } = selectionAnchoring()
    const result = duplicateStrokes(strokes, ids, shiftFor, anchorFor)
    handleCanvasUpdate(JSON.stringify(result.strokes))
    // The copies become the selection, ready to be dragged into place.
    setSelectedIds(new Set(result.newIds))
  }, [readCommittedStrokes, selectionAnchoring, handleCanvasUpdate])

  // Live-coords box of the selection (follows the drag preview).
  const selectionBox = useMemo(
    () => activeSelection
      ? selectionBounds(displayedStrokes, activeSelection, s => liveSectionYShift(s.sectionId, s.sectionOffsetY, headingPositions))
      : null,
    [activeSelection, displayedStrokes, headingPositions],
  )

  const handleLineEdit = useCallback((strokeId: string, points: Array<{ x: number; y: number; pressure: number }>) => {
    let strokes: StrokeData[]
    try {
      strokes = JSON.parse(canvasDataRef.current || '[]') as StrokeData[]
    } catch {
      return
    }
    const index = strokes.findIndex(stroke => stroke.id === strokeId)
    if (index === -1) return

    const anchor = reanchorLine(points, headingPositionsRef.current)
    strokes[index] = { ...strokes[index], points, ...anchor }
    handleCanvasUpdate(JSON.stringify(strokes))
  }, [handleCanvasUpdate])

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


  // Orphaned strokes banner. domOrphanedStrokes comes from the active layer's
  // SectionAnchoredStrokes (sectionId resolves to no live element, e.g. the
  // teacher removed or renamed that section). Strokes on spacers that are
  // still in the spacer data are left out (only orphaned until the spacer is
  // injected). The banner waits ORPHAN_BANNER_DELAY_MS so sections that mount
  // late don't flash it; dismissing hides it until the set of orphans changes.
  const bannerOrphans = useMemo(
    () => reportableOrphans(domOrphanedStrokes, new Set(allSpacersToInject.map(s => s.id))),
    [domOrphanedStrokes, allSpacersToInject],
  )
  const bannerOrphansKey = useMemo(() => bannerOrphans.map(s => s.id).sort().join(','), [bannerOrphans])
  const [settledOrphansKey, setSettledOrphansKey] = useState('')
  const [dismissedOrphansKey, setDismissedOrphansKey] = useState('')
  useEffect(() => {
    if (!bannerOrphansKey) {
      setSettledOrphansKey('')
      return
    }
    const t = setTimeout(() => setSettledOrphansKey(bannerOrphansKey), ORPHAN_BANNER_DELAY_MS)
    return () => clearTimeout(t)
  }, [bannerOrphansKey])
  const orphanedStrokesCount =
    settledOrphansKey !== '' && settledOrphansKey === bannerOrphansKey && dismissedOrphansKey !== bannerOrphansKey
      ? bannerOrphans.length
      : 0

  // "Keep here": anchor the orphans to the section they currently sit in,
  // without moving them. "Delete": remove them. Both go through
  // handleCanvasUpdate (undoable, normal debounced save).
  const handleKeepOrphans = useCallback(() => {
    const ids = new Set(bannerOrphans.map(s => s.id))
    if (ids.size === 0) return
    try {
      const strokes = JSON.parse(canvasDataRef.current || '[]') as StrokeData[]
      handleCanvasUpdate(JSON.stringify(reanchorStrokesInPlace(strokes, ids, headingPositionsRef.current)))
    } catch { /* ignore parse errors */ }
  }, [bannerOrphans, handleCanvasUpdate])

  const handleRemoveOrphans = useCallback(() => {
    const ids = new Set(bannerOrphans.map(s => s.id))
    if (ids.size === 0) return
    try {
      const strokes = JSON.parse(canvasDataRef.current || '[]') as StrokeData[]
      handleCanvasUpdate(JSON.stringify(strokes.filter(s => !ids.has(s.id))))
    } catch { /* ignore parse errors */ }
  }, [bannerOrphans, handleCanvasUpdate])

  const handlePenSelect = useCallback((id: string) => {
    setActivePenId(id)
  }, [])

  // Eraser variant ('stroke' | 'point'), remembered per device like the pens.
  // Default for SSR + first render; the saved choice is loaded after mount.
  const [eraserVariant, setEraserVariant] = useState<EraserVariant>(DEFAULT_ERASER_VARIANT)
  useEffect(() => {
    setEraserVariant(loadEraserVariant())
  }, [])
  const handleEraserVariantChange = useCallback((variant: EraserVariant) => {
    setEraserVariant(variant)
    saveEraserVariant(variant)
  }, [])

  const handlePenColorChange = useCallback((id: string, color: string) => {
    setPens((prev) => setPenColor(prev, id, color))
  }, [])

  const handlePenSizeChange = useCallback((id: string, size: number) => {
    setPens((prev) => setPenSize(prev, id, size))
  }, [])

  const handlePenAdd = useCallback((type: PenType = 'pen') => {
    const next = addPen(pens, type)
    if (next === pens) return // at MAX_PENS
    setPens(next)
    setActivePenId(next[next.length - 1].id) // select the new pen
  }, [pens])

  const handlePenRemove = useCallback((id: string) => {
    const next = removePen(pens, id)
    if (next === pens) return // at MIN_PENS
    setPens(next)
    if (activePenId === id) setActivePenId(next[0].id)
  }, [pens, activePenId])

  const handlePensReorder = useCallback((orderedIds: string[]) => {
    setPens((prev) => reorderPens(prev, orderedIds))
  }, [])

  // Handle snap capture - save directly with base64 URL
  // The sync service will persist to IndexedDB/PostgreSQL
  // S3 upload can be added later as background optimization
  const handleSnapCapture = useCallback((snap: Snap) => {
    setMode('view') // Return to view mode immediately

    // Anchor the snap to the section that currently contains its top edge so
    // it follows that section through layout reflow (spacers, callouts, etc).
    // Without this, sectionId/sectionOffsetY stay undefined and the
    // section-portal renderer falls back to paper-absolute coords — which is
    // the snap-doesn't-follow-spacer bug.
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

  // Dev-only test hooks for the e2e suite (e2e/): read the app's own state,
  // reset all annotations, and inject a snap through the REAL capture path
  // (anchoring included) without driving the paste/crop UI. Stripped from
  // production. Reads refs so values stay current. See e2e/helpers/input.ts.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const w = window as unknown as { __eduTest?: Record<string, unknown> }
    w.__eduTest = {
      ...(w.__eduTest ?? {}),
      state: () => ({
        pageId,
        canvasData: canvasDataRef.current,
        headingPositions: headingPositionsRef.current,
        snaps: snapsData?.snaps ?? [],
      }),
      clear: handleClearAll,
      addSnap: handleSnapCapture,
    }
    return () => {
      if (!w.__eduTest) return
      delete w.__eduTest.state
      delete w.__eduTest.clear
      delete w.__eduTest.addSnap
    }
  }, [handleClearAll, handleSnapCapture, snapsData, pageId])

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

  // Document-level stylus detection when not in stylus mode.
  //
  // A hovering pen sends pointermove before it touches, so stylus mode is on
  // (canvas has pointer-events) by the time it lands. A pen without hover
  // (older Apple Pencil, most Android pens) first touches with the canvas
  // still click-through: its pointerdown targets the page text. For that
  // first contact on the paper (pen takeover):
  //  1. flushSync turns stylus + draw mode on, so the canvas takes pointer
  //     events before this event handler returns;
  //  2. canvas.setPointerCapture moves the rest of this touch (moves, up) to
  //     the canvas;
  //  3. a copy of the pointerdown is dispatched on the canvas, so SimpleCanvas
  //     starts the stroke at the contact point.
  // The touchstart listener below stops the browser from scrolling/selecting
  // with that touch. Interactive elements (PEN_TAKEOVER_SKIP) keep the old
  // behaviour: the first tap only switches modes.
  useEffect(() => {
    if (stylusModeActive) return // Only listen when stylus mode is not active

    const handleDocumentPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      lastPenEventTimeRef.current = Date.now()
      const canvas = e.type === 'pointerdown' && penTakeoverTarget(e.target)
        ? document.querySelector<HTMLCanvasElement>('#paper canvas.annotation-canvas')
        : null
      if (!canvas) {
        handleStylusDetected()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      penTakeoverAtRef.current = Date.now()
      flushSync(() => handleStylusDetected())
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // Pointer no longer active (lifted already): nothing to draw
        return
      }
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        pointerId: e.pointerId, pointerType: 'pen', isPrimary: e.isPrimary,
        clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
        pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY, twist: e.twist,
        width: e.width, height: e.height, button: e.button, buttons: e.buttons,
      }))
    }

    // Listen for both hover (pointermove) and touch (pointerdown). Capture
    // phase, so the takeover runs before the page content sees the event.
    document.addEventListener('pointermove', handleDocumentPointer)
    document.addEventListener('pointerdown', handleDocumentPointer, { capture: true })
    return () => {
      document.removeEventListener('pointermove', handleDocumentPointer)
      document.removeEventListener('pointerdown', handleDocumentPointer, { capture: true })
    }
  }, [stylusModeActive, handleStylusDetected])

  // Pen takeover, part 2: no scrolling / text selection / callout for the
  // touch the pen takeover drew with. pointerdown fires before touchstart
  // (Safari and Chrome), so the takeover timestamp is set by now; iOS also
  // marks the pencil touch as touchType 'stylus' (covers the opposite order).
  // Non-passive on #paper only: finger scrolls starting on the paper wait for
  // this (trivial) handler on the main thread.
  useEffect(() => {
    if (!paperElement) return
    const handleTouchStart = (e: TouchEvent) => {
      const recent = Date.now() - penTakeoverAtRef.current < 300
      const stylus = !stylusModeActiveRef.current &&
        Array.from(e.changedTouches).some(t => (t as Touch & { touchType?: string }).touchType === 'stylus') &&
        penTakeoverTarget(e.target)
      if (recent || stylus) e.preventDefault()
    }
    paperElement.addEventListener('touchstart', handleTouchStart, { passive: false })
    return () => paperElement.removeEventListener('touchstart', handleTouchStart)
  }, [paperElement])

  // Keep updating pen timestamp while drawing (stylus mode active)
  // This is handled directly in the canvas event handlers for better performance
  // Removed document-level listener to avoid overhead on every pointermove event

  // Document-level mouse detection when stylus mode is active
  useEffect(() => {
    if (!stylusModeActive) return // Only listen when stylus mode IS active

    let hasSwitched = false

    const handleDocumentMouseMove = (e: PointerEvent) => {
      // A hovering pen keeps the cooldown fresh. Some platforms (Chromium on
      // Linux with a tablet) send a 'mouse' pointermove next to every pen
      // hover move; without this the cooldown (only refreshed by canvas
      // handlers while drawing) ran out mid-hover and stylus mode flipped off
      // and on: crosshair flashing back to the arrow.
      if (e.pointerType === 'pen') {
        lastPenEventTimeRef.current = Date.now()
        return
      }
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

  // Document-level touch detection when stylus mode is active. In stylus mode
  // the canvas covers the paper with pointer-events:auto, so finger taps never
  // reach plugin iframes (tap-through only finds DOM controls). A finger touch
  // well after the last pen event means the pen was put down: leave stylus
  // mode so the next touch hits the page directly. Touches within the pen
  // cooldown are treated as a resting palm and ignored.
  useEffect(() => {
    if (!stylusModeActive) return

    // Decided 150 ms later: a two/three-finger tap (undo/redo) keeps stylus
    // mode, so wait for the other fingers to land.
    let exitTimer: ReturnType<typeof setTimeout> | null = null
    const handleDocumentTouch = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || fingerDrawModeRef.current) return
      if (Date.now() - lastPenEventTimeRef.current < 1000) return
      if (exitTimer) return
      exitTimer = setTimeout(() => {
        exitTimer = null
        if (Date.now() - lastMultiTouchAtRef.current < 500) return
        setStylusModeActive(false)
        setMode('view')
      }, 150)
    }

    document.addEventListener('pointerdown', handleDocumentTouch, { capture: true })
    return () => {
      if (exitTimer) clearTimeout(exitTimer)
      document.removeEventListener('pointerdown', handleDocumentTouch, { capture: true })
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
      // Horizontally the shrunken page is centered with the CSS `translate`
      // property (applied before `transform`, paint-only, no reflow). A
      // negative marginRight was used before; it widened the auto-width
      // <main> and pushed the mx-auto paper to the right edge.
      spacer?.remove()
      main.style.maxWidth = ''
      const dy = main.scrollHeight * (1 - zoomLevel)
      main.style.marginBottom = `-${dy}px`
      main.style.marginRight = ''
      main.style.translate = `${(main.offsetWidth * (1 - zoomLevel)) / 2}px 0`
      return
    }

    // Reset the zoom-out compensation now that we're at >= 1×.
    main.style.marginBottom = ''
    main.style.marginRight = ''
    main.style.translate = ''

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

        // WebKit stores scrollLeft/Top as integers. Reading them back each
        // wheel event lost up to 1 px per event, so a 30-event burst drifted
        // ~28 px towards the top-left. Reuse the fractional value written last
        // time when the container still sits at it (within rounding).
        const last = wheelScrollRef.current
        const scrollLeft = last && Math.abs(container.scrollLeft - last.left) < 1 ? last.left : container.scrollLeft
        const scrollTop = last && Math.abs(container.scrollTop - last.top) < 1 ? last.top : container.scrollTop

        // Find the content point under the focal point (in unscaled coordinates)
        const contentX = (relativeX + scrollLeft) / oldZoom
        const contentY = (relativeY + scrollTop) / oldZoom

        // Calculate new scroll so the same content point stays under the focal point
        const newScrollX = Math.max(0, contentX * newZoom - relativeX)
        const newScrollY = Math.max(0, contentY * newZoom - relativeY)

        container.scrollLeft = newScrollX
        container.scrollTop = newScrollY
        wheelScrollRef.current = { left: newScrollX, top: newScrollY }
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

  // Custom pinch-zoom handling (native scroll handles single-finger pan).
  // Only finger touches count: an Apple Pencil touch (touchType 'stylus') plus
  // a resting finger is writing, not a pinch (fingerPoints filters it out).
  /** Start (or re-base) a pinch at the two fingers' current position. */
  const setPinchOrigin = useCallback((fingers: TouchPoint[]) => {
    const container = scrollContainerRef.current
    if (!container) return
    if (!pinchOriginRef.current) {
      // New pinch: dead zone only while a two-finger tap (undo) is being tracked.
      pinchEngagedRef.current = tapRef.current === null
    }
    const r = container.getBoundingClientRect()
    pinchOriginRef.current = pinchOrigin(
      fingers[0], fingers[1],
      { left: r.left, top: r.top },
      { left: container.scrollLeft, top: container.scrollTop },
      zoomRef.current,
    )
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const fingers = fingerPoints(e.touches)
    // Multi-finger tap = undo/redo (stylus mode, on the paper).
    if (stylusModeActiveRef.current && !fingerDrawModeRef.current) {
      if (fingers.length >= 2) lastMultiTouchAtRef.current = Date.now()
      const onPaper = (e.target as Element | null)?.closest?.('#paper')
      if (tapRef.current || onPaper) tapRef.current = tapTouchStart(tapRef.current, fingers, Date.now())
    }

    // Track all touches
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Two fingers - start pinch zoom and prevent browser zoom. A third finger
    // pauses the pinch (moves are ignored) until one lifts; handleTouchEnd
    // then re-bases on the remaining pair.
    if (fingers.length === 2) {
      e.preventDefault() // Prevent browser zoom
      setPinchOrigin(fingers)
    }
  }, [setPinchOrigin])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const fingers = fingerPoints(e.touches)
    tapTouchMove(tapRef.current, fingers)

    // Update touch positions
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Handle pinch zoom (2 fingers) - single-finger is handled by native scroll
    const origin = pinchOriginRef.current
    if (fingers.length === 2 && origin) {
      e.preventDefault() // Prevent browser zoom during pinch

      const container = scrollContainerRef.current
      if (!container) return

      const [a, b] = fingers
      if (!pinchEngagedRef.current) {
        if (!pinchLeftDeadZone(origin, a, b)) return
        // Engage, computed from the original origin: the movement inside the
        // dead zone is applied now (one step of ≤ ~TAP_MAX_MOVE px), not lost.
        pinchEngagedRef.current = true
      }

      const r = container.getBoundingClientRect()
      const next = pinchStep(origin, a, b, { left: r.left, top: r.top })

      // Apply transform and scroll synchronously (no RAF) for smooth gesture handling
      zoomRef.current = next.zoom
      renderedZoomRef.current = next.zoom
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${next.zoom})`
      }
      updateZoomSpacer(next.zoom)
      container.scrollLeft = Math.max(0, next.scrollLeft)
      container.scrollTop = Math.max(0, next.scrollTop)
    }
  }, [updateZoomSpacer])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const fingers = fingerPoints(e.touches)
    if (tapRef.current) {
      if (e.type === 'touchcancel') tapRef.current.moved = true
      const { gesture, action } = tapTouchEnd(tapRef.current, fingers.length, Date.now(), lastPenContactRef.current)
      tapRef.current = gesture
      if (action) applyHistoryRef.current?.(action)
    }

    // Remove ended touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      touchesRef.current.delete(touch.identifier)
    }

    if (fingers.length === 2) {
      // 3 → 2 fingers (or a finger of the pair replaced): re-base on the
      // remaining pair, otherwise the next move compares the new pair's
      // distance/midpoint with the old pair's and the page jumps.
      setPinchOrigin(fingers)
    } else if (fingers.length < 2) {
      // Update display zoom state when pinch gesture ends
      if (pinchOriginRef.current !== null) {
        setZoom(zoomRef.current)
      }
      pinchOriginRef.current = null
      pinchEngagedRef.current = false
    }
  }, [setPinchOrigin])

  // Handle trackpad pinch zoom (Ctrl+wheel) and keyboard Ctrl+scroll
  // Trackpad pinch sends wheel events with ctrlKey=true WITHOUT a keydown event
  // So we must always listen for wheel events (non-passive) to intercept them.
  // Plugin iframes forward their pinch as synthetic ctrl+wheel events too
  // (plugin-container.tsx). The transform is applied per rAF (applyZoom); the
  // `zoom` state is committed once, WHEEL_ZOOM_COMMIT_MS after the last event,
  // so the burst does not re-render this layer per event. Stroke geometry does
  // not depend on that state being current (section-anchored-strokes.tsx
  // measures the scale from the DOM, d88145ec).
  const handleZoomWheel = useCallback((e: WheelEvent) => {
    // Only handle zoom when Ctrl/Cmd is pressed (includes trackpad pinch)
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()

    // Calculate zoom factor (negative deltaY means zoom in)
    // Normalize: scroll wheels send large deltaY (~100px), trackpads send small values
    // Use multiplicative scaling for consistent feel at any zoom level
    const factor = Math.pow(1.002, -e.deltaY)
    const newZoom = clampZoom(zoomRef.current * factor)

    // Apply zoom with focal point at cursor position
    applyZoom(newZoom, e.clientX, e.clientY)

    if (wheelZoomCommitTimerRef.current !== null) clearTimeout(wheelZoomCommitTimerRef.current)
    wheelZoomCommitTimerRef.current = setTimeout(() => {
      wheelZoomCommitTimerRef.current = null
      setZoom(zoomRef.current)
    }, WHEEL_ZOOM_COMMIT_MS)
  }, [applyZoom])

  // Attach wheel handler to capture trackpad pinch zoom
  // Must be non-passive to allow preventDefault on Ctrl+wheel
  useEffect(() => {
    document.addEventListener('wheel', handleZoomWheel, { passive: false })

    return () => {
      document.removeEventListener('wheel', handleZoomWheel)
      if (wheelZoomCommitTimerRef.current !== null) clearTimeout(wheelZoomCommitTimerRef.current)
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
        mainRef.current.style.translate = ''
        mainRef.current.style.maxWidth = ''
      }
    }
    // updateZoomSpacer is referentially stable (useCallback with [] deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Narrow viewports (< 1280px): layout.tsx shrinks #paper with
  // `transform: scale(var(--paper-scale))`, which leaves its layout box at the
  // full unscaled height — (1 − scale) × height of blank scroll below the page
  // (3474 px on an 820px iPad). globals.css adds `--paper-scale-margin` to the
  // paper's margin-bottom; this keeps it at −(1 − scale) × paper height. The
  // paper's height changes with content (images, solutions, editors), so a
  // ResizeObserver re-syncs it; on window resize it waits a frame because
  // layout.tsx's own resize listener (registered after this one) sets the new
  // --paper-scale. The zoom spacer / zoom-out margins are re-synced after it,
  // since they are sized from main.scrollHeight.
  useEffect(() => {
    const main = mainRef.current
    const paper = main?.querySelector<HTMLElement>('#paper')
    if (!main || !paper) return
    const root = document.documentElement
    const sync = () => {
      const scale = parseFloat(getComputedStyle(root).getPropertyValue('--paper-scale')) || 1
      if (scale < 1) root.style.setProperty('--paper-scale-margin', `${-(1 - scale) * paper.offsetHeight}px`)
      else root.style.removeProperty('--paper-scale-margin')
      updateZoomSpacer(renderedZoomRef.current)
    }
    let raf: number | null = null
    const onResize = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { raf = null; sync() })
    }
    // Fires once right after observe() too (after layout.tsx's mount effect
    // has set --paper-scale), which does the initial sync.
    const ro = new ResizeObserver(sync)
    ro.observe(paper)
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      if (raf !== null) cancelAnimationFrame(raf)
      root.style.removeProperty('--paper-scale-margin')
    }
    // updateZoomSpacer is referentially stable (useCallback with [] deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Middle-drag moves the paper via the scroll container.
  useDragPan(scrollContainerRef)

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
      {mounted && process.env.NODE_ENV === 'development' && createPortal(
        <div
          className="print-hide print:hidden fixed bottom-4 right-4 bg-black/80 text-white text-xs font-mono px-2 py-1 rounded pointer-events-none"
          style={{ zIndex: 99999 }}
        >
          zoom {(zoom * 100).toFixed(1)}%
        </div>,
        document.body
      )}
      {mounted && historyFlash && createPortal(
        <div
          className="print-hide print:hidden fixed bottom-20 left-1/2 -translate-x-1/2 bg-foreground/85 text-background text-sm px-3 py-1 rounded-full pointer-events-none"
          style={{ zIndex: 99999 }}
          role="status"
        >
          {historyFlash}
        </div>,
        document.body
      )}

      {/* Orphaned strokes banner (see bannerOrphans) */}
      {orphanedStrokesCount > 0 && (
        <div role="status" data-testid="orphan-strokes-banner" className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-400 dark:border-yellow-600 rounded-lg shadow-lg px-4 py-2 max-w-md">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              {orphanedStrokesCount === 1 ? '1 stroke no longer matches' : `${orphanedStrokesCount} strokes no longer match`} the page content (the part {orphanedStrokesCount === 1 ? 'it was' : 'they were'} drawn on changed). {orphanedStrokesCount === 1 ? 'It is' : 'They are'} shown where {orphanedStrokesCount === 1 ? 'it was' : 'they were'} drawn.
            </span>
            <button
              onClick={handleKeepOrphans}
              className="ml-2 px-2 py-1 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded text-xs text-yellow-900 dark:text-yellow-100 whitespace-nowrap"
              title="Attach the strokes to the content they now sit next to"
            >
              Keep here
            </button>
            <button
              onClick={handleRemoveOrphans}
              className="px-2 py-1 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded text-xs text-yellow-900 dark:text-yellow-100 whitespace-nowrap"
            >
              Delete
            </button>
            <button
              onClick={() => setDismissedOrphansKey(bannerOrphansKey)}
              className="px-1 text-sm leading-none text-yellow-800 dark:text-yellow-200"
              aria-label="Dismiss"
            >
              ×
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
          ref={canvasWrapperRef}
          // While a highlighter is active the wrapper (a z-index stacking
          // context holding the live canvas) blends with the page like the
          // committed highlighter SVGs, so the in-progress stroke looks the same.
          className={`annotation-content-wrapper ${!activeLayerVisible ? 'annotation-layer-hidden' : ''} ${highlighterActive ? 'annotation-highlighter' : ''}`}
          style={{
            height: pageHeight,
            // Always capture events when in draw/erase mode or stylus mode (spacer mode bypasses canvas).
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
              they were drawn until the user keeps or deletes them via the orphans banner. */}
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
            highlighter={activePen.type === 'highlight'}
            eraserVariant={eraserVariant}
            onPointErasePreview={setPointErasePreview}
            onLassoSelect={handleLassoSelect}
            onUpdate={handleCanvasUpdate}
            onTelemetry={handleTelemetry}
            onDrawStart={ensureActiveLayerVisible}
            onEraserMarksChange={setEraserMarkedIds}
            initialData={canvasData}
            strokeColor={activePen.color}
            strokeWidth={activePen.size}
            stylusModeActive={stylusModeActive}
            onStylusDetected={handleStylusDetected}
            onNonStylusInput={handleNonStylusInput}
            onPenStateChange={handlePenStateChange}
            zoom={zoom}
            headingPositions={headingPositions}
            svgHandlesDisplay
            scrollContainer={scrollContainerRef.current}
          />
          {mode === 'draw' && selectionBox && (
            <AnnotationSelection
              bounds={selectionBox}
              zoom={zoom}
              onPreviewMove={setSelectionDrag}
              onCommitMove={handleSelectionMove}
              onDelete={handleSelectionDelete}
              onDuplicate={handleSelectionDuplicate}
              onDismiss={clearSelection}
            />
          )}
          {/* Badge for active layer - shown on toolbar hover only */}
          {showActiveLayerBadge && hasAnnotations && (
            <LayerBadges
              canvasData={liveBadgeCanvasData}
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
          strokes={displayedStrokes}
          paperWidth={paperWidth}
          paperHeight={pageHeight}
          paperPaddingLeft={currentPaddingLeft}
          markedForDeletion={eraserMarkedIds}
          onOrphansChange={setDomOrphanedStrokes}
          headingPositions={headingPositions}
          onLineEdit={handleLineEdit}
          // Handles stay out of the way while a tool is active: in draw/erase
          // mode the first click of a new stroke must reach the canvas.
          // A selection hides them too, so a selected line has one owner.
          lineEditEnabled={mode === 'view' && !stylusModeActive && !activeSelection}
          selectedIds={activeSelection ?? undefined}
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

      {/* Toolbar: shown to every viewer, anonymous visitors included (core feature). */}
      <AnnotationToolbar
        mode={mode}
        onModeChange={setMode}
        onClear={handleClearAll}
        onUndo={() => applyHistory('undo')}
        onRedo={() => applyHistory('redo')}
        canUndo={historyCounts.undo > 0}
        canRedo={historyCounts.redo > 0}
        hasAnnotations={hasAnnotations || (spacersData?.spacers?.length ?? 0) > 0 || (snapsData?.snaps?.length ?? 0) > 0 || stickyNoteCount > 0}
        pens={pens}
        activePenId={activePenId}
        onPenSelect={handlePenSelect}
        onPenColorChange={handlePenColorChange}
        onPenSizeChange={handlePenSizeChange}
        onPenAdd={handlePenAdd}
        onPenRemove={handlePenRemove}
        onPensReorder={handlePensReorder}
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
        eraserVariant={eraserVariant}
        onEraserVariantChange={handleEraserVariantChange}
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
