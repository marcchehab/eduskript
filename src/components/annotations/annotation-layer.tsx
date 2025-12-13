'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import { useSyncedUserData, useUserDataContext, type SyncedUserDataOptions } from '@/lib/userdata/provider'
import type { AnnotationData, StrokeTelemetry, TelemetryData } from '@/lib/userdata/types'
import type { SnapsData } from '@/lib/userdata/adapters'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { repositionStrokes } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useTeacherBroadcast } from '@/hooks/use-teacher-broadcast'
import { useSession } from 'next-auth/react'
import { SnapOverlay, type Snap } from './snap-overlay'
import { SnapsDisplay } from './snaps-display'

/**
 * Reposition teacher annotations to align with student's heading positions.
 * This handles cross-device alignment when teacher broadcasts annotations.
 */
function repositionTeacherAnnotations(
  canvasData: string,
  teacherHeadingOffsets: Record<string, number> | undefined,
  teacherPaddingLeft: number | undefined,
  studentHeadingPositions: HeadingPosition[],
  studentPaddingLeft: number
): string {
  // If no teacher heading offsets, can't reposition - return as-is
  if (!teacherHeadingOffsets || Object.keys(teacherHeadingOffsets).length === 0) {
    return canvasData
  }

  // If student hasn't calculated heading positions yet, return as-is
  if (studentHeadingPositions.length === 0) {
    return canvasData
  }

  try {
    const strokes: StrokeData[] = JSON.parse(canvasData)
    if (strokes.length === 0) return canvasData

    const result = repositionStrokes(
      strokes,
      studentHeadingPositions,
      teacherHeadingOffsets,
      studentPaddingLeft,
      teacherPaddingLeft
    )

    return JSON.stringify(result.strokes)
  } catch {
    // If parsing fails, return original data
    return canvasData
  }
}

interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
}

export function AnnotationLayer({ pageId, content, children }: AnnotationLayerProps) {
  const { sidebarWidth, viewportWidth, viewportHeight } = useLayout()
  const { data: session } = useSession()
  const { selectedClass, setSelectedClass, selectedStudent, setSelectedStudent, viewMode, isTeacher } = useTeacherClass()
  const { setAnnotationVersionMismatch, setOnClearAnnotations } = useUserDataContext()

  // State for classes and students lists (for toolbar broadcast controls)
  const [teacherClasses, setTeacherClasses] = useState<Array<{ id: string; name: string; hasAnnotationsOnPage?: boolean }>>([])
  const [classStudents, setClassStudents] = useState<Array<{ id: string; displayName: string; pseudonym?: string; hasAnnotationsOnPage?: boolean }>>([])

  // Track last selected student for quick-access and data loading when in class-broadcast mode
  const [lastSelectedStudent, setLastSelectedStudent] = useState<{ id: string; displayName: string; pseudonym?: string } | null>(null)

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

  // Fetch students when a class is selected (with annotation status for current page)
  useEffect(() => {
    if (!isTeacher || !selectedClass || !pageId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally clear when class is deselected
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
  const syncOptions: SyncedUserDataOptions = useMemo(() => {
    if (!isTeacher) return {}

    if (viewMode === 'class-broadcast' && selectedClass) {
      return { targetType: 'class', targetId: selectedClass.id }
    }
    if (viewMode === 'student-view' && selectedStudent) {
      return { targetType: 'student', targetId: selectedStudent.id }
    }
    return {} // my-view: personal annotations
  }, [isTeacher, viewMode, selectedClass, selectedStudent])

  // Create a stable key for targeting to detect changes
  const targetingKey = `${syncOptions.targetType ?? ''}-${syncOptions.targetId ?? ''}`

  // Use synced user data service for annotations (with targeting for teachers)
  const { data: annotationData, updateData: updateAnnotationData, isLoading: annotationLoading } = useSyncedUserData<AnnotationData>(
    pageId,
    'annotations',
    null,
    syncOptions
  )

  // Use synced user data service for snaps
  // IMPORTANT: initialData must be a stable reference, not an inline object literal
  const emptySnapsData = useMemo(() => ({ snaps: [] } as SnapsData), [])
  const { data: snapsData, updateData: updateSnapsData, isLoading: snapsLoading } = useSyncedUserData<SnapsData>(
    pageId,
    'snaps',
    emptySnapsData
  )

  // For students: fetch teacher annotations (class broadcasts + individual feedback)
  const isStudent = session?.user?.accountType === 'student'
  const {
    classAnnotations: teacherClassAnnotations,
    individualFeedback: teacherIndividualFeedback,
    isLoading: teacherAnnotationsLoading,
    refetch: refetchTeacherAnnotations,
  } = useTeacherBroadcast(isStudent ? pageId : '')

  // For teachers: also load personal annotations when broadcasting to class/student
  // This allows them to see their personal annotations as a reference layer
  const shouldLoadPersonalAsReference = isTeacher && viewMode !== 'my-view'
  const { data: personalAnnotationData, updateData: updatePersonalAnnotationData } = useSyncedUserData<AnnotationData>(
    shouldLoadPersonalAsReference ? pageId : '',
    'annotations',
    null,
    {} // No targeting = personal annotations
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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional one-time init from localStorage
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
      // Teacher just switched from personal to class/student view
      // Auto-hide personal reference layer (controls button state in broadcast mode)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: sync layer visibility when broadcast target changes
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
      // Teacher just switched from individual student to entire class
      // Auto-hide student feedback layer (unless manually toggled before)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: sync layer visibility when broadcast target changes
      setLayerVisibility(prev => {
        const next = { ...prev, 'student-feedback': false }
        if (typeof window !== 'undefined') {
          localStorage.setItem('annotation-layer-visibility', JSON.stringify(next))
        }
        return next
      })
    }
    prevViewModeRef.current = viewMode
  }, [isTeacher, viewMode])

  // Helper to get default visibility for a layer
  const getDefaultVisibility = useCallback((layerId: string) => {
    // Personal hidden by default when teacher is broadcasting
    if (layerId === 'personal' && isTeacher && viewMode !== 'my-view') {
      return false
    }
    // Student feedback hidden by default when in class-broadcast mode
    if (layerId === 'student-feedback' && isTeacher && viewMode === 'class-broadcast') {
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
    toggleLayerVisibility('class-broadcast')
  }, [toggleLayerVisibility])

  // Student feedback visibility (for teachers)
  const studentFeedbackVisible = isLayerVisible('student-feedback')
  const toggleStudentFeedbackVisibility = useCallback(() => {
    toggleLayerVisibility('student-feedback')
  }, [toggleLayerVisibility])

  // Check which layers have content
  const hasPersonalContent = shouldLoadPersonalAsReference &&
    personalAnnotationData?.canvasData &&
    personalAnnotationData.canvasData.length > 0 &&
    personalAnnotationData.canvasData !== '[]'

  const hasClassContent = teacherClassAnnotations.length > 0
  const hasIndividualContent = teacherIndividualFeedback !== null

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

  const { data: studentFeedbackData, updateData: updateStudentFeedbackData } = useSyncedUserData<AnnotationData>(
    shouldLoadStudentFeedback ? pageId : '__skip__', // Use placeholder to skip loading
    'annotations',
    null,
    studentFeedbackSyncOptions
  )

  const [mode, setMode] = useState<AnnotationMode>('view')
  const [pageVersion, setPageVersion] = useState<string>('')
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [canvasData, setCanvasData] = useState<string>('')

  // Check if class broadcast and student feedback layers have content
  // IMPORTANT: When in the respective mode, use local canvasData/hasAnnotations state (which updates immediately)
  // because the useSyncedUserData hooks don't update until after save completes
  const hasClassBroadcastAnnotations = useMemo(() => {
    // When actively editing class broadcast, use local state for immediate feedback
    if (viewMode === 'class-broadcast') {
      return hasAnnotations
    }
    // Otherwise use the hook data
    return !!(classBroadcastData?.canvasData &&
      classBroadcastData.canvasData.length > 0 &&
      classBroadcastData.canvasData !== '[]')
  }, [classBroadcastData, viewMode, hasAnnotations])

  const hasStudentFeedbackAnnotations = useMemo(() => {
    // When actively editing student feedback, use local state for immediate feedback
    if (viewMode === 'student-view') {
      return hasAnnotations
    }
    // Otherwise use the hook data
    return !!(studentFeedbackData?.canvasData &&
      studentFeedbackData.canvasData.length > 0 &&
      studentFeedbackData.canvasData !== '[]')
  }, [studentFeedbackData, viewMode, hasAnnotations])

  // Canvas ref needed by delete callbacks
  const canvasRef = useRef<SimpleCanvasHandle | null>(null)

  // Delete class broadcast annotations specifically
  const deleteClassBroadcastData = useCallback(async () => {
    if (isTeacher && selectedClass && updateClassBroadcastData) {
      await updateClassBroadcastData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
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
  }, [isTeacher, selectedClass, updateClassBroadcastData, viewMode, classBroadcastData?.canvasData?.length])

  // Delete student feedback annotations specifically
  // Works for both selected student and last selected student (in class-broadcast mode)
  const deleteStudentFeedbackData = useCallback(async () => {
    if (isTeacher && studentForFeedback && updateStudentFeedbackData) {
      await updateStudentFeedbackData({ canvasData: '', headingOffsets: {}, pageVersion: '' }, { immediate: true })
      // If currently viewing student feedback, also clear local state
      if (viewMode === 'student-view') {
        setCanvasData('')
        setHasAnnotations(false)
        if (canvasRef.current) {
          canvasRef.current.clear()
        }
      }
      // Update the brush icon indicator in the student dropdown
      setClassStudents(prev => prev.map(s =>
        s.id === studentForFeedback.id ? { ...s, hasAnnotationsOnPage: false } : s
      ))
    }
  }, [isTeacher, selectedStudent, studentForFeedback, updateStudentFeedbackData, viewMode, studentFeedbackData?.canvasData?.length])

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

  // Save state tracking
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [stylusModeActive, setStylusModeActive] = useState(false)
  const [activePen, setActivePen] = useState(0)

  // Track if pen is currently hovering or drawing - controls pointer-events on canvas
  const [penActive, setPenActive] = useState(false)
  // Use refs for zoom to avoid re-renders on every gesture
  const zoomRef = useRef(1.0)
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
  const defaultPenSizes: [number, number, number] = [4, 8, 14]

  const [penColors, setPenColors] = useState<[string, string, string]>(defaultPenColors)
  const [penSizes, setPenSizes] = useState<[number, number, number]>(defaultPenSizes)

  // Load pen settings from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const savedColors = localStorage.getItem('annotation-pen-colors')
    if (savedColors) {
      try {
        const parsed = JSON.parse(savedColors)
        if (Array.isArray(parsed) && parsed.length === 3) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional one-time init from localStorage
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
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)
  const [pageHeight, setPageHeight] = useState(0)
  const [orphanedStrokesCount, setOrphanedStrokesCount] = useState(0)
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
    }))
  }, [snapsData?.snaps])

  // Pen priority: pen always wins, ignore other inputs for 200ms after last pen event
  const lastPenEventTimeRef = useRef<number>(0)

  // Canvas width matches paper width exactly including padding
  // Paper element for portal (canvas renders directly into #paper)
  const [paperElement, setPaperElement] = useState<HTMLElement | null>(null)

  // Main element for snaps portal (snaps need to overflow paper boundaries)
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null)

  const [paperWidth, setPaperWidth] = useState(1280) // Fixed paper width

  // Get paper element for portal and measure its width
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (paper) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Getting DOM element
      setPaperElement(paper)

      setPaperWidth(paper.getBoundingClientRect().width)

      // Ensure paper has position:relative for absolute canvas positioning
      paper.style.position = 'relative'

      // Also get main element for snaps portal (snaps need to overflow paper)
      const main = paper.closest('main')
      if (main) {
        setMainElement(main)
        main.style.position = 'relative'
      }
    }
  }, [viewportWidth])

  // Track annotating state in ref for event handlers (avoids stale closure issues)
  const isAnnotatingRef = useRef(false)
  useEffect(() => {
    isAnnotatingRef.current = mode !== 'view' || stylusModeActive
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
    const preventTouchDuringPen = (e: TouchEvent) => {
      if (!isAnnotatingRef.current) return

      const timeSinceLastPen = Date.now() - lastPenEventTimeRef.current
      // If a touch event happens within 300ms of pen activity, block it
      // This is likely a touch event triggered by the pen itself, not a finger
      if (timeSinceLastPen < 300) {
        const target = e.target as Element
        if (target?.tagName === 'CANVAS' || target?.closest('#paper')) {
          e.preventDefault()
        }
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

  // Track previous targeting key to detect class/student switches
  const prevTargetingKeyRef = useRef(targetingKey)

  // Reset canvas state when targeting changes (e.g., teacher switches class)
  // This MUST run before the data loading effect below
  useEffect(() => {
    // Skip on initial mount (no previous value to compare)
    if (prevTargetingKeyRef.current === targetingKey) return

    // Clear local canvas state to allow new data to load
    // DON'T call canvasRef.current.clear() here - it triggers onUpdate which sets canvasData to '[]'
    // Instead, just reset state and let SimpleCanvas reload via initialData prop change
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: reset state when targeting changes
    setCanvasData('')
    setHasAnnotations(false)
    setStoredHeadingOffsets({})
    setStoredPaddingLeft(undefined)

    // Update the ref for next comparison
    prevTargetingKeyRef.current = targetingKey
  }, [targetingKey])

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
          // eslint-disable-next-line react-hooks/set-state-in-effect -- Loading stored state
          setHasAnnotations(true)
          setCanvasData(annotationData.canvasData)
          setStoredHeadingOffsets(annotationData.headingOffsets || {})
          setStoredPaddingLeft(annotationData.paddingLeft)
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [annotationData, canvasData, targetingKey])

  // Initialize storedHeadingOffsets when heading positions are first available
  useEffect(() => {
    if (headingPositions.length > 0 && Object.keys(storedHeadingOffsets).length === 0) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initializing state
      setStoredHeadingOffsets(currentOffsets)
    }
  }, [headingPositions, storedHeadingOffsets])

  // Apply repositioning when heading positions or padding change (only if needed)
  useEffect(() => {
    if (!canvasData || headingPositions.length === 0 || Object.keys(storedHeadingOffsets).length === 0) return

    try {
      const strokes: StrokeData[] = JSON.parse(canvasData)
      if (strokes.length === 0) return

      // Check if repositioning is needed
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )

      // Only reposition if stored offsets differ from current offsets OR padding changed
      const needsVerticalReposition = Object.keys(storedHeadingOffsets).some(
        key => storedHeadingOffsets[key] !== currentOffsets[key]
      )
      const needsHorizontalReposition = storedPaddingLeft !== undefined &&
        Math.abs(currentPaddingLeft - storedPaddingLeft) > 1 // Allow 1px tolerance

      if (needsVerticalReposition || needsHorizontalReposition) {
        const result = repositionStrokes(
          strokes,
          headingPositions,
          storedHeadingOffsets,
          currentPaddingLeft,
          storedPaddingLeft
        )
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Repositioning stored data
        setCanvasData(JSON.stringify(result.strokes))

        setOrphanedStrokesCount(result.orphanedCount)
        // Update stored values so we don't reposition again

        setStoredHeadingOffsets(currentOffsets)
        setStoredPaddingLeft(currentPaddingLeft)
      }
    } catch {
      // Ignore repositioning errors
    }
  }, [headingPositions, storedHeadingOffsets, canvasData, currentPaddingLeft, storedPaddingLeft])

  // Helper function to recalculate heading positions and paper dimensions
  const recalculateHeadingPositions = useCallback(() => {
    if (!contentRef.current) return

    // Get full paper dimensions including padding
    const paperElement = document.getElementById('paper')
    if (paperElement) {
      setPageHeight(paperElement.offsetHeight)

      // Also recalculate paper dimensions when content changes
      const paperRect = paperElement.getBoundingClientRect()
      const style = window.getComputedStyle(paperElement)

      const paddingLeft = parseFloat(style.paddingLeft) || 0

      // Track current padding for horizontal repositioning
      setCurrentPaddingLeft(paddingLeft)

      setPaperWidth(paperRect.width)
    }

    // Query for all elements with data-section-id (headings, code blocks, callouts, etc.)
    const sectionElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
    const positions: HeadingPosition[] = []
    const paperRect = paperElement!.getBoundingClientRect()

    sectionElements.forEach((element) => {
      const sectionId = element.getAttribute('data-section-id')
      const headingText = element.getAttribute('data-heading-text')
      const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

      if (sectionId) {
        // Get the element's position relative to paper element
        const rect = element.getBoundingClientRect()

        // Add top reference point
        positions.push({
          sectionId,
          offsetY: rect.top - paperRect.top,
          headingText: headingText || ''
        })

        // For dynamic-height elements (callouts, code editors), also track bottom
        // This ensures annotations BELOW these elements move when they expand/collapse
        if (isDynamicHeight) {
          positions.push({
            sectionId: `${sectionId}-end`,
            offsetY: rect.bottom - paperRect.top,
            headingText: ''
          })
        }
      }
    })

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
    return () => {
      window.removeEventListener('resize', handleResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [recalculateHeadingPositions])

  // Watch dynamic-height elements (callouts, code editors) for size changes
  // This triggers repositioning when callouts expand/collapse or editors show console output
  useEffect(() => {
    if (!contentRef.current) return

    const dynamicElements = contentRef.current.querySelectorAll<HTMLElement>('[data-dynamic-height="true"]')
    if (dynamicElements.length === 0) return

    let rafId: number | null = null
    let isScheduled = false

    const resizeObserver = new ResizeObserver(() => {
      // Debounce with requestAnimationFrame
      if (!isScheduled) {
        isScheduled = true
        rafId = requestAnimationFrame(() => {
          recalculateHeadingPositions()
          isScheduled = false
        })
      }
    })

    dynamicElements.forEach(el => resizeObserver.observe(el))

    return () => {
      resizeObserver.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [children, recalculateHeadingPositions])

  // Function to perform the actual save
  // IMPORTANT: Uses refs instead of state to avoid stale closure issues when called from setTimeout
  const performSave = useCallback(async () => {
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

        sectionElements.forEach((element) => {
          const sectionId = element.getAttribute('data-section-id')
          const headingText = element.getAttribute('data-heading-text')
          const isDynamicHeight = element.getAttribute('data-dynamic-height') === 'true'

          if (sectionId) {
            const rect = element.getBoundingClientRect()

            // Add top reference point
            positions.push({
              sectionId,
              offsetY: rect.top - paperRect.top,
              headingText: headingText || ''
            })

            // For dynamic-height elements, also track bottom
            if (isDynamicHeight) {
              positions.push({
                sectionId: `${sectionId}-end`,
                offsetY: rect.bottom - paperRect.top,
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

      const data: AnnotationData = {
        canvasData: currentCanvasData,
        headingOffsets,
        pageVersion: currentPageVersion,
        paddingLeft
      }

      setSaveState('saving')

      // Use immediate: true since we're already debouncing at component level
      await updateAnnotationData(data, { immediate: true })

      setSaveState('saved')

      // Reset to idle after showing success briefly
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')

      // Reset to idle after showing error briefly
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }, [updateAnnotationData])

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

    // Update stored heading offsets to current positions when drawing new strokes
    // This prevents newly drawn strokes from being repositioned when content changes
    if (headingPositions.length > 0) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      setStoredHeadingOffsets(currentOffsets)
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 2000)
  }, [performSave, headingPositions, ensureActiveLayerVisible, isTeacher, viewMode, selectedClass, selectedStudent])

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

      // Clear canvas
      if (canvasRef.current) {
        canvasRef.current.clear()
      }
    } catch {
      // Ignore clearing errors
    }
  }, [deleteAnnotationData, setAnnotationVersionMismatch])

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
    } catch (err) {
      console.error('Failed to clear personal annotations:', err)
    }
  }, [deletePersonalAnnotationData, shouldLoadPersonalAsReference, setAnnotationVersionMismatch])

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

  // Handle snap reorder
  const handleReorderSnaps = useCallback((reorderedSnaps: Snap[]) => {
    // Convert Snap[] to SnapData[]
    const reorderedSnapData = reorderedSnaps.map(snap => ({
      id: snap.id,
      name: snap.name,
      imageUrl: snap.imageUrl,
      top: snap.top,
      left: snap.left,
      width: snap.width,
      height: snap.height,
    }))
    updateSnapsData({ snaps: reorderedSnapData })
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

  // Calculate scroll limits based on main content bounds
  // Helper function to apply zoom transform using RAF (no re-renders)
  // With native scroll, we only need to handle zoom - scroll is handled by browser
  const applyZoom = useCallback((newZoom: number, focalX?: number, focalY?: number) => {
    const oldZoom = zoomRef.current
    zoomRef.current = newZoom

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    // Apply transform in next frame
    rafIdRef.current = requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
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
      const newZoom = Math.max(0.5, Math.min(2.5, initialZoomRef.current * zoomFactor))

      // Convert current pinch center to container-relative coordinates
      const relativeX = currentCenterX - containerRect.left
      const relativeY = currentCenterY - containerRect.top

      // Calculate scroll position to keep the initial content point under the current pinch center
      // Formula: contentPoint * newZoom - relativePosition = newScroll
      const newScrollX = initialContentPointRef.current.x * newZoom - relativeX
      const newScrollY = initialContentPointRef.current.y * newZoom - relativeY

      // Apply transform and scroll synchronously (no RAF) for smooth gesture handling
      zoomRef.current = newZoom
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
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
    const newZoom = Math.max(0.5, Math.min(2.5, zoomRef.current * (1 + delta)))

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
        {children}
      </div>

      {/* Canvas portaled directly into #paper - always matches paper bounds */}
      {paperElement && pageHeight > 0 && createPortal(
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            // Width is determined by left:0 + right:0, not explicit value
            height: pageHeight,
            // Always capture events when in draw/erase mode or stylus mode
            pointerEvents: (mode !== 'view' || stylusModeActive) ? 'auto' : 'none',
            // CRITICAL: When pen is actively drawing, disable touch actions to prevent scroll
            // When pen is not drawing, allow touch scrolling
            touchAction: penActive ? 'none' : 'auto',
            zIndex: 10,
            // Hide when my annotations visibility is toggled off
            opacity: activeLayerVisible ? 1 : 0,
            transition: 'opacity 0.15s ease-in-out'
          }}
        >
          <SimpleCanvas
            ref={canvasRef}
            width={paperWidth}
            height={pageHeight}
            mode={mode === 'view' ? 'view' : (mode as DrawMode)}
            onUpdate={handleCanvasUpdate}
            onTelemetry={handleTelemetry}
            onDrawStart={ensureActiveLayerVisible}
            initialData={canvasData}
            strokeColor={penColors[activePen]}
            strokeWidth={penSizes[activePen]}
            stylusModeActive={stylusModeActive}
            onStylusDetected={handleStylusDetected}
            onNonStylusInput={handleNonStylusInput}
            onPenStateChange={handlePenStateChange}
            zoom={zoom}
            headingPositions={headingPositions}
          />
        </div>,
        paperElement
      )}

      {/* Reference annotation layers - read-only overlays */}
      {!teacherAnnotationsLoading && paperElement && pageHeight > 0 && (
        <>
          {/* Teacher's personal annotations as reference (when broadcasting to class/student) */}
          {hasPersonalContent && isLayerVisible('personal') && (() => {
            const repositionedCanvasData = repositionTeacherAnnotations(
              personalAnnotationData!.canvasData,
              personalAnnotationData!.headingOffsets,
              personalAnnotationData!.paddingLeft,
              headingPositions,
              currentPaddingLeft
            )

            return createPortal(
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 7, // Below all other layers
                  opacity: 0.5,
                }}
              >
                <SimpleCanvas
                  width={paperWidth}
                  height={pageHeight}
                  mode="view"
                  initialData={repositionedCanvasData}
                  headingPositions={headingPositions}
                  zoom={zoom}
                  readOnly
                />
              </div>,
              paperElement
            )
          })()}

          {/* Teacher's class broadcast as reference (when giving individual student feedback) */}
          {isTeacher && viewMode === 'student-view' && classBroadcastData?.canvasData && isLayerVisible('class-broadcast') && (() => {
            return createPortal(
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 7, // Below active layer
                  opacity: 0.5,
                }}
              >
                <SimpleCanvas
                  width={paperWidth}
                  height={pageHeight}
                  mode="view"
                  initialData={classBroadcastData.canvasData}
                  headingPositions={headingPositions}
                  zoom={zoom}
                  readOnly
                />
              </div>,
              paperElement
            )
          })()}

          {/* Student feedback as reference (when broadcasting to entire class but want to see last student's feedback) */}
          {isTeacher && viewMode === 'class-broadcast' && studentFeedbackData?.canvasData && isLayerVisible('student-feedback') && (() => {
            return createPortal(
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 7, // Below active layer
                  opacity: 0.5,
                }}
              >
                <SimpleCanvas
                  width={paperWidth}
                  height={pageHeight}
                  mode="view"
                  initialData={studentFeedbackData.canvasData}
                  headingPositions={headingPositions}
                  zoom={zoom}
                  readOnly
                />
              </div>,
              paperElement
            )
          })()}

          {/* Class broadcast annotations (blue tint) - for students */}
          {isStudent && teacherClassAnnotations.map((classAnnotation) => {
            const layerId = `class-${classAnnotation.classId}`
            if (!isLayerVisible(layerId)) return null

            const layerAnnotationData = classAnnotation.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData) return null

            const repositionedCanvasData = repositionTeacherAnnotations(
              layerAnnotationData.canvasData,
              layerAnnotationData.headingOffsets,
              layerAnnotationData.paddingLeft,
              headingPositions,
              currentPaddingLeft
            )

            return (
              <div key={classAnnotation.classId}>
                {createPortal(
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: pageHeight,
                      pointerEvents: 'none',
                      zIndex: 8,
                    }}
                  >
                    <SimpleCanvas
                      width={paperWidth}
                      height={pageHeight}
                      mode="view"
                      initialData={repositionedCanvasData}
                      headingPositions={headingPositions}
                      zoom={zoom}
                      readOnly
                    />
                  </div>,
                  paperElement
                )}
              </div>
            )
          })}

          {/* Individual feedback annotations (orange tint) - for students */}
          {isStudent && teacherIndividualFeedback && isLayerVisible('individual') && (() => {
            const layerAnnotationData = teacherIndividualFeedback.data as AnnotationData | null
            if (!layerAnnotationData?.canvasData) return null

            const repositionedCanvasData = repositionTeacherAnnotations(
              layerAnnotationData.canvasData,
              layerAnnotationData.headingOffsets,
              layerAnnotationData.paddingLeft,
              headingPositions,
              currentPaddingLeft
            )

            return createPortal(
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: pageHeight,
                  pointerEvents: 'none',
                  zIndex: 9,
                }}
              >
                <SimpleCanvas
                  width={paperWidth}
                  height={pageHeight}
                  mode="view"
                  initialData={repositionedCanvasData}
                  headingPositions={headingPositions}
                  zoom={zoom}
                  readOnly
                />
              </div>,
              paperElement
            )
          })()}
        </>
      )}

      {/* Toolbar */}
      <AnnotationToolbar
        mode={mode}
        onModeChange={setMode}
        onClear={handleClearAll}
        hasAnnotations={hasAnnotations}
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
        // My annotations controls (person icon - always controls personal annotations)
        myAnnotationsVisible={myAnnotationsVisible}
        myAnnotationsActive={myAnnotationsActive}
        onMyAnnotationsToggle={toggleMyAnnotationsVisibility}
        onMyAnnotationsDelete={handleClearPersonalAnnotations}
        // Broadcast controls for teachers
        isTeacher={isTeacher}
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
      />

      {/* Snap overlay - shown when in snap mode */}
      {mode === 'snap' && (
        <SnapOverlay
          onCapture={handleSnapCapture}
          onCancel={() => setMode('view')}
          nextSnapNumber={snaps.length + 1}
          zoom={zoom}
        />
      )}

      {/* Snaps display - portaled into main so snaps can overflow paper boundaries */}
      {mainElement && createPortal(
        <SnapsDisplay
          snaps={snaps}
          onRemoveSnap={handleRemoveSnap}
          onRenameSnap={handleRenameSnap}
          onReorderSnaps={handleReorderSnaps}
          zoom={zoom}
        />,
        mainElement
      )}
    </>
  )
}
