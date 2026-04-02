'use client'

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { GripVertical, Trash2, Globe, Users, User, Image, Palette, Minus, Plus } from 'lucide-react'
import type { Snap, SnapColor } from '@/types/snap'
import { SnapViewerOverlay } from './snap-viewer-overlay'

const SNAP_COLORS: SnapColor[] = ['blue', 'yellow', 'green', 'pink', 'purple']

const SNAP_COLOR_CONFIG: Record<SnapColor, {
  bg: string; header: string; border: string; dot: string
}> = {
  blue: {
    bg: 'bg-sky-50 dark:bg-sky-950/50',
    header: 'bg-sky-100 dark:bg-sky-900/70',
    border: 'border-sky-200 dark:border-sky-800',
    dot: 'bg-sky-400',
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/50',
    header: 'bg-yellow-100 dark:bg-yellow-900/70',
    border: 'border-yellow-200 dark:border-yellow-800',
    dot: 'bg-yellow-400',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    header: 'bg-emerald-100 dark:bg-emerald-900/70',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-400',
  },
  pink: {
    bg: 'bg-rose-50 dark:bg-rose-950/50',
    header: 'bg-rose-100 dark:bg-rose-900/70',
    border: 'border-rose-200 dark:border-rose-800',
    dot: 'bg-rose-400',
  },
  purple: {
    bg: 'bg-violet-50 dark:bg-violet-950/50',
    header: 'bg-violet-100 dark:bg-violet-900/70',
    border: 'border-violet-200 dark:border-violet-800',
    dot: 'bg-violet-400',
  },
}

// Teacher snap type includes layer info
export interface TeacherSnap extends Snap {
  layerId: string
  layerName: string
  isTeacherSnap: true
}

// Student work snap type (for teachers viewing student's work)
export interface StudentWorkSnap extends Snap {
  layerId: string
  layerName: string
  isStudentWorkSnap: true
}

// Position override type
export type SnapPositionOverrides = Record<string, { top: number; left: number; width: number; height: number }>
export type SnapOverridesData = { classSnaps: SnapPositionOverrides; feedbackSnaps: SnapPositionOverrides; publicSnaps?: SnapPositionOverrides; studentWorkSnaps?: SnapPositionOverrides }

// Helper to get icon and color based on layer type
function getLayerIcon(layerId: string): { Icon: typeof Globe; colorClass: string; borderClass: string } {
  if (layerId === 'public') {
    return { Icon: Globe, colorClass: 'text-green-500', borderClass: 'border-green-500' }
  }
  if (layerId.startsWith('class-')) {
    return { Icon: Users, colorClass: 'text-blue-500', borderClass: 'border-blue-500' }
  }
  if (layerId === 'individual') {
    return { Icon: User, colorClass: 'text-orange-500', borderClass: 'border-orange-500' }
  }
  if (layerId === 'student-work') {
    return { Icon: User, colorClass: 'text-purple-500', borderClass: 'border-purple-500' }
  }
  // Default fallback
  return { Icon: User, colorClass: 'text-blue-500', borderClass: 'border-blue-500' }
}

interface SnapsDisplayProps {
  snaps: Snap[]
  onRemoveSnap: (id: string) => void
  onRenameSnap: (id: string, newName: string) => void
  onUpdateSnap: (id: string, updates: Partial<Snap>) => void
  onReorderSnaps: (snaps: Snap[]) => void
  teacherSnaps?: TeacherSnap[]
  studentWorkSnaps?: StudentWorkSnap[]
  snapOverrides?: SnapOverridesData | null
  onTeacherSnapOverride?: (snapId: string, layerType: 'class' | 'individual' | 'public', position: { top: number; left: number; width: number; height: number }) => void
  onStudentWorkSnapOverride?: (snapId: string, position: { top: number; left: number; width: number; height: number }) => void
  zoom: number
  paperWidth: number // Paper width in pixels for drag delta conversion
  initialLoadComplete?: boolean // Whether all annotation/snap data has loaded (for unified fade-in)
}

// Minimum distance to move before considering it a drag (in pixels)
const DRAG_THRESHOLD = 5

const DEBUG_STATE = false

// Student work snap component - moveable by teacher viewing student's work
const StudentWorkSnapItem = memo(function StudentWorkSnapItem({
  snap,
  zoom,
  onExpand,
  overridePosition,
  onPositionChange,
  paperWidth,
}: {
  snap: StudentWorkSnap
  zoom: number
  onExpand: (id: string) => void
  overridePosition?: { top: number; left: number; width: number; height: number }
  onPositionChange?: (position: { top: number; left: number; width: number; height: number }) => void
  paperWidth: number
}) {
  if (DEBUG_STATE) console.log(`[StudentWorkSnapItem ${snap.id.slice(-4)}] Render`)

  const elementRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Use override position if available, otherwise use original snap position
  const position = useMemo(() =>
    overridePosition || { top: snap.top, left: snap.left, width: snap.width, height: snap.height },
    [overridePosition, snap.top, snap.left, snap.width, snap.height]
  )

  const dragStateRef = useRef<{
    isDragging: boolean
    isResizing: boolean
    startX: number
    startY: number
    startTop: number
    startLeft: number
    startWidth: number
    startHeight: number
    currentX: number
    currentY: number
    currentWidth: number
    currentHeight: number
  }>({
    isDragging: false,
    isResizing: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
    startWidth: 0,
    startHeight: 0,
    currentX: 0,
    currentY: 0,
    currentWidth: 0,
    currentHeight: 0,
  })

  const handlePointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handlePointerUpRef = useRef<() => void>(() => {})

  useEffect(() => {
    handlePointerMoveRef.current = (e: PointerEvent) => {
      const state = dragStateRef.current
      if (!state.isDragging && !state.isResizing) return

      const element = elementRef.current
      if (!element) return

      const deltaX = (e.clientX - state.startX) / zoom
      const deltaY = (e.clientY - state.startY) / zoom

      if (state.isDragging) {
        state.currentX = deltaX
        state.currentY = deltaY
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`
      } else if (state.isResizing) {
        const aspectRatio = state.startWidth / state.startHeight
        const scale = Math.max(0.5, 1 + (deltaX + deltaY) / (state.startWidth + state.startHeight))
        const newWidth = Math.max(100, state.startWidth * scale)
        const newHeight = newWidth / aspectRatio

        state.currentWidth = newWidth
        state.currentHeight = newHeight

        element.style.width = `${newWidth}px`
        if (imageRef.current) {
          imageRef.current.style.width = `${newWidth}px`
          imageRef.current.style.height = `${newHeight}px`
        }
      }
    }
  }, [zoom])

  // Store onPositionChange in a ref to avoid stale closures
  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  // Store current position in ref for pointer handlers
  const positionRef = useRef(position)
  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    handlePointerUpRef.current = () => {
      const state = dragStateRef.current
      const element = elementRef.current

      window.removeEventListener('pointermove', handlePointerMoveRef.current)
      window.removeEventListener('pointerup', handlePointerUpRef.current)

      if (!element) {
        state.isDragging = false
        state.isResizing = false
        return
      }

      element.style.transform = ''
      element.style.opacity = ''
      element.style.boxShadow = ''
      element.style.zIndex = ''
      element.style.cursor = ''

      if (state.isDragging) {
        const finalTop = state.startTop + state.currentY
        const finalLeft = state.startLeft + state.currentX
        // Persist the new position via callback
        onPositionChangeRef.current?.({
          top: finalTop,
          left: finalLeft,
          width: positionRef.current.width,
          height: positionRef.current.height,
        })
      } else if (state.isResizing) {
        // Persist the new size via callback
        onPositionChangeRef.current?.({
          top: positionRef.current.top,
          left: positionRef.current.left,
          width: state.currentWidth,
          height: state.currentHeight,
        })
      }

      state.isDragging = false
      state.isResizing = false
    }
  }, [])

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isDragging = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = position.top
    state.startLeft = position.left
    state.startWidth = position.width
    state.startHeight = position.height
    state.currentX = 0
    state.currentY = 0

    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'
    element.style.cursor = 'grabbing'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [position.top, position.left, position.width, position.height])

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isResizing = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = position.top
    state.startLeft = position.left
    state.startWidth = position.width
    state.startHeight = position.height
    state.currentWidth = position.width
    state.currentHeight = position.height

    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [position.top, position.left, position.width, position.height])

  const { Icon, colorClass, borderClass } = getLayerIcon(snap.layerId)

  return (
    <div
      ref={elementRef}
      className="absolute z-50 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 shadow-md rounded-xl overflow-hidden group transition-shadow duration-150 hover:shadow-xl student-work-snap-fade-in"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        willChange: 'transform',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 bg-sky-100 dark:bg-sky-900/70 border-b border-sky-200 dark:border-sky-800 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handleDragStart}
      >
        <GripVertical className="w-3 h-3 opacity-30 shrink-0" />
        <Image className="w-3 h-3 opacity-50 shrink-0" />
        <span className="text-xs opacity-60 truncate flex-1 min-w-0">
          {snap.name}
        </span>
        <span className={`text-xs ${colorClass} flex items-center gap-1 shrink-0`}>
          <Icon className="w-3 h-3" />
        </span>
      </div>

      {/* Image */}
      <div
        className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
        onClick={() => onExpand(snap.id)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={snap.imageUrl}
          alt={snap.name}
          className="block"
          style={{
            width: position.width,
            height: position.height,
            border: 'none',
          }}
        />
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-70 flex items-end justify-end pb-0.5 pr-0.5 transition-opacity"
        style={{ touchAction: 'none' }}
        onPointerDown={handleResizeStart}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-sky-500">
          <path d="M15 10L10 15M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
})

// Teacher snap component - read-only, moveable but no delete
const TeacherSnapItem = memo(function TeacherSnapItem({
  snap,
  zoom,
  onExpand,
  overridePosition,
  onPositionChange,
  paperWidth,
}: {
  snap: TeacherSnap
  zoom: number
  onExpand: (id: string) => void
  overridePosition?: { top: number; left: number; width: number; height: number }
  onPositionChange?: (position: { top: number; left: number; width: number; height: number }) => void
  paperWidth: number
}) {
  if (DEBUG_STATE) console.log(`[TeacherSnapItem ${snap.id.slice(-4)}] Render`)

  const elementRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Use override position if available, otherwise use original snap position
  const position = useMemo(() =>
    overridePosition || { top: snap.top, left: snap.left, width: snap.width, height: snap.height },
    [overridePosition, snap.top, snap.left, snap.width, snap.height]
  )

  const dragStateRef = useRef<{
    isDragging: boolean
    isResizing: boolean
    startX: number
    startY: number
    startTop: number
    startLeft: number
    startWidth: number
    startHeight: number
    currentX: number
    currentY: number
    currentWidth: number
    currentHeight: number
  }>({
    isDragging: false,
    isResizing: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
    startWidth: 0,
    startHeight: 0,
    currentX: 0,
    currentY: 0,
    currentWidth: 0,
    currentHeight: 0,
  })

  const handlePointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handlePointerUpRef = useRef<() => void>(() => {})

  useEffect(() => {
    handlePointerMoveRef.current = (e: PointerEvent) => {
      const state = dragStateRef.current
      if (!state.isDragging && !state.isResizing) return

      const element = elementRef.current
      if (!element) return

      const deltaX = (e.clientX - state.startX) / zoom
      const deltaY = (e.clientY - state.startY) / zoom

      if (state.isDragging) {
        state.currentX = deltaX
        state.currentY = deltaY
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`
      } else if (state.isResizing) {
        const aspectRatio = state.startWidth / state.startHeight
        const scale = Math.max(0.5, 1 + (deltaX + deltaY) / (state.startWidth + state.startHeight))
        const newWidth = Math.max(100, state.startWidth * scale)
        const newHeight = newWidth / aspectRatio

        state.currentWidth = newWidth
        state.currentHeight = newHeight

        element.style.width = `${newWidth}px`
        if (imageRef.current) {
          imageRef.current.style.width = `${newWidth}px`
          imageRef.current.style.height = `${newHeight}px`
        }
      }
    }
  }, [zoom])

  // Store onPositionChange in a ref to avoid stale closures
  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  // Store current position in ref for pointer handlers
  const positionRef = useRef(position)
  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    handlePointerUpRef.current = () => {
      const state = dragStateRef.current
      const element = elementRef.current

      window.removeEventListener('pointermove', handlePointerMoveRef.current)
      window.removeEventListener('pointerup', handlePointerUpRef.current)

      if (!element) {
        state.isDragging = false
        state.isResizing = false
        return
      }

      element.style.transform = ''
      element.style.opacity = ''
      element.style.boxShadow = ''
      element.style.zIndex = ''
      element.style.cursor = ''

      if (state.isDragging) {
        const finalTop = state.startTop + state.currentY
        const finalLeft = state.startLeft + state.currentX
        // Persist the new position via callback
        onPositionChangeRef.current?.({
          top: finalTop,
          left: finalLeft,
          width: positionRef.current.width,
          height: positionRef.current.height,
        })
      } else if (state.isResizing) {
        // Persist the new size via callback
        onPositionChangeRef.current?.({
          top: positionRef.current.top,
          left: positionRef.current.left,
          width: state.currentWidth,
          height: state.currentHeight,
        })
      }

      state.isDragging = false
      state.isResizing = false
    }
  }, [])

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isDragging = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = position.top
    state.startLeft = position.left
    state.startWidth = position.width
    state.startHeight = position.height
    state.currentX = 0
    state.currentY = 0

    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'
    element.style.cursor = 'grabbing'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [position.top, position.left, position.width, position.height])

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isResizing = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = position.top
    state.startLeft = position.left
    state.startWidth = position.width
    state.startHeight = position.height
    state.currentWidth = position.width
    state.currentHeight = position.height

    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [position.top, position.left, position.width, position.height])

  const { Icon, colorClass, borderClass } = getLayerIcon(snap.layerId)

  return (
    <div
      ref={elementRef}
      className="absolute z-50 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 shadow-md rounded-xl overflow-hidden group transition-shadow duration-150 hover:shadow-xl teacher-snap-fade-in"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        willChange: 'transform',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 bg-sky-100 dark:bg-sky-900/70 border-b border-sky-200 dark:border-sky-800 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handleDragStart}
      >
        <GripVertical className="w-3 h-3 opacity-30 shrink-0" />
        <Image className="w-3 h-3 opacity-50 shrink-0" />
        <span className="text-xs opacity-60 truncate flex-1 min-w-0">
          {snap.name}
        </span>
        <span className={`text-xs ${colorClass} flex items-center gap-1 shrink-0`}>
          <Icon className="w-3 h-3" />
        </span>
      </div>

      {/* Image */}
      <div
        className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
        onClick={() => onExpand(snap.id)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={snap.imageUrl}
          alt={snap.name}
          className="block"
          style={{
            width: position.width,
            height: position.height,
            border: 'none',
          }}
        />
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-70 flex items-end justify-end pb-0.5 pr-0.5 transition-opacity"
        style={{ touchAction: 'none' }}
        onPointerDown={handleResizeStart}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-sky-500">
          <path d="M15 10L10 15M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
})

// Individual snap component - memoized to prevent unnecessary re-renders
const SnapItem = memo(function SnapItem({
  snap,
  isNew,
  onRemove,
  onRename,
  onUpdate,
  onReorder,
  onExpand,
  onBringToFront,
  zoom,
  allSnaps,
  paperWidth,
  zIndex,
}: {
  snap: Snap
  isNew: boolean
  onRemove: (id: string) => void
  onRename: (id: string, newName: string) => void
  onUpdate: (id: string, updates: Partial<Snap>) => void
  onReorder: (snaps: Snap[]) => void
  onExpand: (id: string) => void
  onBringToFront: (id: string) => void
  zoom: number
  allSnaps: Snap[]
  paperWidth: number
  zIndex: number
}) {
  if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Render - top:${snap.top.toFixed(0)} left:${snap.left.toFixed(0)}`)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [showColorPicker, setShowColorPicker] = useState(false)

  const color = snap.color || 'blue'
  const cfg = SNAP_COLOR_CONFIG[color]
  const elementRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Store current transform during drag (not position - we use transform for smooth movement)
  const dragStateRef = useRef<{
    isDragging: boolean
    isResizing: boolean
    isPotentialDrag: boolean // True when pointer is down but hasn't moved enough to be a drag
    hasMoved: boolean // True once movement exceeds threshold
    startX: number
    startY: number
    startTop: number
    startLeft: number
    startWidth: number
    startHeight: number
    currentX: number
    currentY: number
    currentWidth: number
    currentHeight: number
  }>({
    isDragging: false,
    isResizing: false,
    isPotentialDrag: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
    startWidth: 0,
    startHeight: 0,
    currentX: 0,
    currentY: 0,
    currentWidth: 0,
    currentHeight: 0,
  })

  // Use refs for handlers to avoid stale closures and self-reference issues
  const handlePointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handlePointerUpRef = useRef<() => void>(() => {})

  // Update handlers when dependencies change
  useEffect(() => {
    handlePointerMoveRef.current = (e: PointerEvent) => {
      const state = dragStateRef.current
      if (!state.isDragging && !state.isResizing && !state.isPotentialDrag) return

      const element = elementRef.current
      if (!element) return

      const deltaX = (e.clientX - state.startX) / zoom
      const deltaY = (e.clientY - state.startY) / zoom

      // Check if we've exceeded the drag threshold (for potential drags from image area)
      if (state.isPotentialDrag && !state.hasMoved) {
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
        if (distance > DRAG_THRESHOLD) {
          // Convert to actual drag
          state.hasMoved = true
          state.isDragging = true
          state.isPotentialDrag = false
          // Apply visual feedback now that we're actually dragging
          element.style.opacity = '0.9'
          element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
          element.style.zIndex = '1000'
          element.style.cursor = 'grabbing'
        }
        return // Don't move yet until threshold is exceeded
      }

      if (state.isDragging) {
        state.currentX = deltaX
        state.currentY = deltaY
        // Use transform for smooth movement (GPU accelerated)
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`
      } else if (state.isResizing) {
        const aspectRatio = state.startWidth / state.startHeight
        const scale = Math.max(0.5, 1 + (deltaX + deltaY) / (state.startWidth + state.startHeight))
        const newWidth = Math.max(100, state.startWidth * scale)
        const newHeight = newWidth / aspectRatio

        state.currentWidth = newWidth
        state.currentHeight = newHeight

        element.style.width = `${newWidth}px`
        if (imageRef.current) {
          imageRef.current.style.width = `${newWidth}px`
          imageRef.current.style.height = `${newHeight}px`
        }
      }
    }
  }, [zoom])

  // Store callbacks and data in refs to avoid stale closures during drag operations
  const onExpandRef = useRef(onExpand)
  const onBringToFrontRef = useRef(onBringToFront)
  const onReorderRef = useRef(onReorder)
  const allSnapsRef = useRef(allSnaps)
  useEffect(() => {
    onExpandRef.current = onExpand
    onBringToFrontRef.current = onBringToFront
    onReorderRef.current = onReorder
    allSnapsRef.current = allSnaps
  }, [onExpand, onBringToFront, onReorder, allSnaps])

  useEffect(() => {
    handlePointerUpRef.current = () => {
      const state = dragStateRef.current
      const element = elementRef.current

      if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] PointerUp - isDragging:${state.isDragging} isResizing:${state.isResizing} isPotentialDrag:${state.isPotentialDrag} hasMoved:${state.hasMoved}`)

      window.removeEventListener('pointermove', handlePointerMoveRef.current)
      window.removeEventListener('pointerup', handlePointerUpRef.current)

      // If it was a potential drag that never moved enough, treat as click (expand)
      if (state.isPotentialDrag && !state.hasMoved) {
        state.isPotentialDrag = false
        onExpandRef.current(snap.id)
        onBringToFrontRef.current(snap.id) // Also bring to front when expanding
        return
      }

      if (!element) {
        state.isDragging = false
        state.isResizing = false
        state.isPotentialDrag = false
        state.hasMoved = false
        return
      }

      // Reset visual styles (but keep z-index high until React re-renders with updated state)
      element.style.transform = ''
      element.style.opacity = ''
      element.style.boxShadow = ''
      // Don't reset z-index here - let React update it via state
      element.style.cursor = ''

      if (state.isDragging) {
        // Calculate final position (both in pixels)
        const finalTop = state.startTop + state.currentY
        const finalLeft = state.startLeft + state.currentX

        if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Drag end - finalTop:${finalTop.toFixed(0)} finalLeft:${finalLeft.toFixed(0)}`)

        // Bring to front first, then update position
        // This order is important: z-index update happens before position update
        onBringToFrontRef.current(snap.id)

        // Update all snaps with new position (use refs for latest values)
        const newSnaps = allSnapsRef.current.map(s =>
          s.id === snap.id ? { ...s, top: finalTop, left: finalLeft } : s
        )
        onReorderRef.current(newSnaps)
      } else if (state.isResizing) {
        if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Resize end - width:${state.currentWidth.toFixed(0)} height:${state.currentHeight.toFixed(0)}`)

        // Update all snaps with new size (use refs for latest values)
        const newSnaps = allSnapsRef.current.map(s =>
          s.id === snap.id ? { ...s, width: state.currentWidth, height: state.currentHeight } : s
        )
        onReorderRef.current(newSnaps)
      }

      state.isDragging = false
      state.isResizing = false
      state.isPotentialDrag = false
      state.hasMoved = false
    }
  }, [snap.id])

  // Start dragging immediately (from titlebar)
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isDragging = true
    state.isPotentialDrag = false
    state.hasMoved = false
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = snap.top
    state.startLeft = snap.left
    state.startWidth = snap.width
    state.startHeight = snap.height
    state.currentX = 0
    state.currentY = 0

    // Visual feedback
    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'
    element.style.cursor = 'grabbing'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [snap.top, snap.left, snap.width, snap.height])

  // Start potential drag from image area (click vs drag detection)
  const handleImagePointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle left click
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isPotentialDrag = true
    state.isDragging = false
    state.hasMoved = false
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = snap.top
    state.startLeft = snap.left
    state.startWidth = snap.width
    state.startHeight = snap.height
    state.currentX = 0
    state.currentY = 0

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [snap.top, snap.left, snap.width, snap.height])

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isResizing = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startTop = snap.top
    state.startLeft = snap.left
    state.startWidth = snap.width
    state.startHeight = snap.height
    state.currentWidth = snap.width
    state.currentHeight = snap.height

    // Visual feedback
    element.style.opacity = '0.9'
    element.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)'
    element.style.zIndex = '1000'

    window.addEventListener('pointermove', handlePointerMoveRef.current)
    window.addEventListener('pointerup', handlePointerUpRef.current)
  }, [snap.top, snap.left, snap.width, snap.height])

  const handleStartEdit = () => {
    setIsEditing(true)
    setEditName(snap.name)
  }

  const handleSaveEdit = () => {
    if (editName.trim()) onRename(snap.id, editName.trim())
    setIsEditing(false)
    setEditName('')
  }

  return (
    <div
      ref={elementRef}
      className={`absolute ${cfg.bg} border ${cfg.border} shadow-md rounded-xl overflow-hidden group transition-shadow duration-150 hover:shadow-xl`}
      style={{
        top: snap.top,
        left: snap.left,
        width: snap.minimized ? 'auto' : snap.width,
        willChange: 'transform',
        animation: isNew ? 'snap-fade-in 0.05s ease-out forwards' : undefined,
        zIndex: zIndex,
      }}
    >
      {/* Drag handle / titlebar */}
      <div
        className={`flex items-center gap-1 px-2 py-1.5 ${cfg.header} border-b ${cfg.border} cursor-grab active:cursor-grabbing select-none`}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement
          if (!target.closest('.snap-title')) {
            handleDragStart(e)
          } else {
            onBringToFront(snap.id)
          }
        }}
      >
        <GripVertical className="w-3 h-3 opacity-30 shrink-0" />
        <Image className="w-3 h-3 opacity-50 shrink-0" />

        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit()
              else if (e.key === 'Escape') setIsEditing(false)
            }}
            onBlur={handleSaveEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="snap-title px-2 py-1 text-xs border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation()
              handleStartEdit()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="snap-title text-xs opacity-60 truncate flex-1 min-w-0 cursor-text hover:opacity-100 transition-opacity"
          >
            {snap.name}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 ml-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowColorPicker(v => !v)}
            className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            title="Change colour"
          >
            <Palette className="w-3 h-3" />
          </button>
          <button
            onClick={() => onUpdate(snap.id, { minimized: !snap.minimized })}
            className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            title={snap.minimized ? 'Expand' : 'Minimize'}
          >
            {snap.minimized ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onRemove(snap.id)}
            className="w-5 h-5 rounded flex items-center justify-center opacity-40 hover:opacity-100 hover:text-red-500 transition-all"
            title="Remove snap"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Colour picker row */}
      {showColorPicker && (
        <div
          className={`flex items-center gap-1.5 px-2.5 py-2 shrink-0 border-b ${cfg.border}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {SNAP_COLORS.map(c => (
            <button
              key={c}
              onClick={() => { onUpdate(snap.id, { color: c }); setShowColorPicker(false) }}
              className={`w-5 h-5 rounded-full border-2 transition-all duration-100 hover:scale-110 ${SNAP_COLOR_CONFIG[c].dot} ${
                color === c ? 'border-foreground scale-110 shadow-sm' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
              title={c.charAt(0).toUpperCase() + c.slice(1)}
            />
          ))}
        </div>
      )}

      {/* Image - click to expand, drag to move */}
      {!snap.minimized && (
        <div
          className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
          style={{ touchAction: 'none' }}
          onPointerDown={handleImagePointerDown}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={snap.imageUrl}
            alt={snap.name}
            className="block pointer-events-none"
            style={{
              width: snap.width,
              height: snap.height,
              border: 'none',
            }}
            draggable={false}
          />
        </div>
      )}

      {/* Resize handle */}
      {!snap.minimized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-70 flex items-end justify-end pb-0.5 pr-0.5 transition-opacity"
          style={{ touchAction: 'none' }}
          onPointerDown={handleResizeStart}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-foreground/50">
            <path d="M15 10L10 15M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
})

export function SnapsDisplay({ snaps, onRemoveSnap, onRenameSnap, onUpdateSnap, onReorderSnaps, teacherSnaps = [], studentWorkSnaps = [], snapOverrides, onTeacherSnapOverride, onStudentWorkSnapOverride, zoom, paperWidth, initialLoadComplete = true }: SnapsDisplayProps) {
  if (DEBUG_STATE) console.log(`[SnapsDisplay] Render - ${snaps.length} snaps, ${teacherSnaps.length} teacher snaps, ${studentWorkSnaps.length} student work snaps`)

  const [expandedSnapIndex, setExpandedSnapIndex] = useState<number | null>(null)
  const [expandedIsTeacher, setExpandedIsTeacher] = useState(false)
  const [expandedIsStudentWork, setExpandedIsStudentWork] = useState(false)
  const [newSnapIds, setNewSnapIds] = useState<Set<string>>(new Set())
  const prevSnapIdsRef = useRef<Set<string>>(new Set())

  // Track z-index order - higher index means more recently focused/interacted
  // Base z-index starts at 45 (above annotations), each snap gets offset based on order
  const [zIndexOrder, setZIndexOrder] = useState<string[]>([])
  const lastExpandedSnapIdRef = useRef<string | null>(null)

  // Initialize z-index order with snap IDs (new snaps at end = on top)
  // Only update when snap IDs change (add/remove), not for position changes
  const snapIds = useMemo(() => snaps.map(s => s.id).sort().join(','), [snaps])
  useEffect(() => {
    const currentIds = snaps.map(s => s.id)
    setZIndexOrder(prev => {
      // Keep existing order, add new snaps at the end (on top)
      const newOrder = prev.filter(id => currentIds.includes(id))
      currentIds.forEach(id => {
        if (!newOrder.includes(id)) {
          newOrder.push(id)
        }
      })
      return newOrder
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapIds])

  // Bring a snap to front (highest z-index)
  const handleBringToFront = useCallback((id: string) => {
    if (DEBUG_STATE) console.log(`[SnapsDisplay] handleBringToFront called for ${id}`)
    setZIndexOrder(prev => {
      const filtered = prev.filter(snapId => snapId !== id)
      const newOrder = [...filtered, id]
      if (DEBUG_STATE) console.log(`[SnapsDisplay] zIndexOrder: ${prev.join(',')} -> ${newOrder.join(',')}`)
      return newOrder // Move to end (top)
    })
  }, [])

  // Track new snaps for fade-in animation
  // All detection and state updates happen in effect to avoid ref access during render
  useEffect(() => {
    const currentIds = new Set(snaps.map(s => s.id))
    const prevIds = prevSnapIdsRef.current

    const newIds = new Set<string>()
    currentIds.forEach(id => {
      if (!prevIds.has(id)) newIds.add(id)
    })

    if (newIds.size > 0) {
       
      setNewSnapIds(newIds)
      const timer = setTimeout(() => setNewSnapIds(new Set()), 150)
      prevSnapIdsRef.current = currentIds
      return () => clearTimeout(timer)
    }

    prevSnapIdsRef.current = currentIds
  }, [snaps])

  const handleExpand = useCallback((id: string) => {
    const index = snaps.findIndex(s => s.id === id)
    if (index !== -1) {
      setExpandedSnapIndex(index)
      setExpandedIsTeacher(false)
      setExpandedIsStudentWork(false)
      lastExpandedSnapIdRef.current = id
      // Bring to front when expanding
      handleBringToFront(id)
    }
  }, [snaps, handleBringToFront])

  const handleTeacherSnapExpand = useCallback((id: string) => {
    const index = teacherSnaps.findIndex(s => s.id === id)
    if (index !== -1) {
      setExpandedSnapIndex(index)
      setExpandedIsTeacher(true)
      setExpandedIsStudentWork(false)
    }
  }, [teacherSnaps])

  const handleStudentWorkSnapExpand = useCallback((id: string) => {
    const index = studentWorkSnaps.findIndex(s => s.id === id)
    if (index !== -1) {
      setExpandedSnapIndex(index)
      setExpandedIsTeacher(false)
      setExpandedIsStudentWork(true)
    }
  }, [studentWorkSnaps])

  if (snaps.length === 0 && teacherSnaps.length === 0 && studentWorkSnaps.length === 0) return null

  // Get snaps for the viewer based on which type is expanded
  const viewerSnaps = expandedIsStudentWork ? studentWorkSnaps : (expandedIsTeacher ? teacherSnaps : snaps)

  return (
    <>
      {/* All snaps wrapped in unified fade-in container */}
      {/* Waits for initialLoadComplete to prevent multiple redraws during initial page load */}
      {/* Uses CSS animation that plays on mount for smooth fade-in */}
      {initialLoadComplete && (
        <div className="annotation-content-wrapper" style={{ zIndex: 45 }}>
          {/* Student's own snaps */}
          {DEBUG_STATE && console.log(`[SnapsDisplay] Render - zIndexOrder: [${zIndexOrder.join(', ')}]`)}
          {snaps.map((snap) => {
            // Calculate z-index based on order in zIndexOrder array
            const orderIndex = zIndexOrder.indexOf(snap.id)
            const snapZIndex = 45 + (orderIndex >= 0 ? orderIndex : 0)
            if (DEBUG_STATE) console.log(`[SnapsDisplay] ${snap.id.slice(-8)} orderIndex=${orderIndex} zIndex=${snapZIndex}`)

            return (
              <SnapItem
                key={snap.id}
                snap={snap}
                isNew={newSnapIds.has(snap.id)}
                onRemove={onRemoveSnap}
                onRename={onRenameSnap}
                onUpdate={onUpdateSnap}
                onReorder={onReorderSnaps}
                onExpand={handleExpand}
                onBringToFront={handleBringToFront}
                zoom={zoom}
                allSnaps={snaps}
                paperWidth={paperWidth}
                zIndex={snapZIndex}
              />
            )
          })}
          {/* Teacher snaps (read-only, moveable) */}
        {teacherSnaps.map((snap) => {
          // Determine which override map to use based on layer type
          const isClassSnap = snap.layerId.startsWith('class-')
          const isPublicSnap = snap.layerId === 'public'
          const overrideKey = isPublicSnap ? 'publicSnaps' : isClassSnap ? 'classSnaps' : 'feedbackSnaps'
          const layerType = isPublicSnap ? 'public' : isClassSnap ? 'class' : 'individual' as const
          const overridePosition = snapOverrides?.[overrideKey]?.[snap.id]

          return (
            <TeacherSnapItem
              key={snap.id}
              snap={snap}
              zoom={zoom}
              onExpand={handleTeacherSnapExpand}
              overridePosition={overridePosition}
              onPositionChange={onTeacherSnapOverride ? (pos) => onTeacherSnapOverride(snap.id, layerType, pos) : undefined}
              paperWidth={paperWidth}
            />
          )
        })}

        {/* Student work snaps (moveable by teachers viewing student's work) */}
        {studentWorkSnaps.map((snap) => {
          const overridePosition = snapOverrides?.studentWorkSnaps?.[snap.id]

          return (
            <StudentWorkSnapItem
              key={snap.id}
              snap={snap}
              zoom={zoom}
              onExpand={handleStudentWorkSnapExpand}
              overridePosition={overridePosition}
              onPositionChange={onStudentWorkSnapOverride ? (pos) => onStudentWorkSnapOverride(snap.id, pos) : undefined}
              paperWidth={paperWidth}
            />
          )
        })}
        </div>
      )}

      {/* Expanded snap modal */}
      {expandedSnapIndex !== null && (
        <SnapViewerOverlay
          snaps={viewerSnaps}
          initialIndex={expandedSnapIndex}
          onClose={() => {
            // Bring the snap to front when closing the viewer
            if (lastExpandedSnapIdRef.current && !expandedIsTeacher && !expandedIsStudentWork) {
              handleBringToFront(lastExpandedSnapIdRef.current)
            }
            setExpandedSnapIndex(null)
            setExpandedIsTeacher(false)
            setExpandedIsStudentWork(false)
          }}
        />
      )}
    </>
  )
}
