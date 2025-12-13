'use client'

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import type { Snap } from './snap-overlay'
import { SnapViewerOverlay } from './snap-viewer-overlay'

// Teacher snap type includes layer info
export interface TeacherSnap extends Snap {
  layerId: string
  layerName: string
  isTeacherSnap: true
}

// Position override type
export type SnapPositionOverrides = Record<string, { top: number; left: number; width: number; height: number }>
export type SnapOverridesData = { classSnaps: SnapPositionOverrides; feedbackSnaps: SnapPositionOverrides }

interface SnapsDisplayProps {
  snaps: Snap[]
  onRemoveSnap: (id: string) => void
  onRenameSnap: (id: string, newName: string) => void
  onReorderSnaps: (snaps: Snap[]) => void
  teacherSnaps?: TeacherSnap[]
  snapOverrides?: SnapOverridesData | null
  onTeacherSnapOverride?: (snapId: string, layerType: 'class' | 'individual', position: { top: number; left: number; width: number; height: number }) => void
  zoom: number
}

const DEBUG_STATE = false

// Teacher snap component - read-only, moveable but no delete
const TeacherSnapItem = memo(function TeacherSnapItem({
  snap,
  zoom,
  onExpand,
  overridePosition,
  onPositionChange,
}: {
  snap: TeacherSnap
  zoom: number
  onExpand: (id: string) => void
  overridePosition?: { top: number; left: number; width: number; height: number }
  onPositionChange?: (position: { top: number; left: number; width: number; height: number }) => void
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

  return (
    <div
      ref={elementRef}
      className="absolute z-40 bg-card border-2 border-blue-500 shadow-lg rounded-lg overflow-hidden group teacher-snap-fade-in"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        willChange: 'transform',
      }}
    >
      {/* Drag handle - styled differently for teacher snaps */}
      <div
        className="px-3 py-2 bg-muted/50 border-b border-border flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handleDragStart}
      >
        <GripVertical className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {snap.name}
        </span>
        <span className="text-xs text-blue-500 ml-auto">
          {snap.layerName}
        </span>
      </div>

      {/* Image */}
      <div
        className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden rounded-b-lg -m-px"
        onClick={() => onExpand(snap.id)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={snap.imageUrl}
          alt={snap.name}
          className="block rounded-b-lg"
          style={{
            width: position.width,
            height: position.height,
            border: 'none',
          }}
        />
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
        style={{ touchAction: 'none' }}
        onPointerDown={handleResizeStart}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-blue-500">
          <path d="M15 10L10 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
  onReorder,
  onExpand,
  zoom,
  allSnaps,
}: {
  snap: Snap
  isNew: boolean
  onRemove: (id: string) => void
  onRename: (id: string, newName: string) => void
  onReorder: (snaps: Snap[]) => void
  onExpand: (id: string) => void
  zoom: number
  allSnaps: Snap[]
}) {
  if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Render - top:${snap.top.toFixed(0)} left:${snap.left.toFixed(0)}`)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const elementRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Store current transform during drag (not position - we use transform for smooth movement)
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

  // Use refs for handlers to avoid stale closures and self-reference issues
  const handlePointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handlePointerUpRef = useRef<() => void>(() => {})

  // Update handlers when dependencies change
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

  useEffect(() => {
    handlePointerUpRef.current = () => {
      const state = dragStateRef.current
      const element = elementRef.current

      if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] PointerUp - isDragging:${state.isDragging} isResizing:${state.isResizing}`)

      window.removeEventListener('pointermove', handlePointerMoveRef.current)
      window.removeEventListener('pointerup', handlePointerUpRef.current)

      if (!element) {
        state.isDragging = false
        state.isResizing = false
        return
      }

      // Reset visual styles
      element.style.transform = ''
      element.style.opacity = ''
      element.style.boxShadow = ''
      element.style.zIndex = ''
      element.style.cursor = ''

      if (state.isDragging) {
        // Calculate final position
        const finalTop = state.startTop + state.currentY
        const finalLeft = state.startLeft + state.currentX

        if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Drag end - finalTop:${finalTop.toFixed(0)} finalLeft:${finalLeft.toFixed(0)}`)

        // Update all snaps with new position
        const newSnaps = allSnaps.map(s =>
          s.id === snap.id ? { ...s, top: finalTop, left: finalLeft } : s
        )
        onReorder(newSnaps)
      } else if (state.isResizing) {
        if (DEBUG_STATE) console.log(`[SnapItem ${snap.id.slice(-4)}] Resize end - width:${state.currentWidth.toFixed(0)} height:${state.currentHeight.toFixed(0)}`)

        // Update all snaps with new size
        const newSnaps = allSnaps.map(s =>
          s.id === snap.id ? { ...s, width: state.currentWidth, height: state.currentHeight } : s
        )
        onReorder(newSnaps)
      }

      state.isDragging = false
      state.isResizing = false
    }
  }, [snap.id, allSnaps, onReorder])

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = elementRef.current
    if (!element) return

    const state = dragStateRef.current
    state.isDragging = true
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
      className="absolute z-40 bg-background border-2 border-primary shadow-lg rounded-lg overflow-hidden group"
      style={{
        top: snap.top,
        left: snap.left,
        width: snap.width,
        willChange: 'transform',
        animation: isNew ? 'snap-fade-in 0.05s ease-out forwards' : undefined,
      }}
    >
      {/* Control buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={() => onRemove(snap.id)}
          className="p-1 bg-background/90 backdrop-blur border border-border rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="Remove snap"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Drag handle */}
      <div
        className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement
          if (!target.closest('.snap-title')) {
            handleDragStart(e)
          }
        }}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />

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
            className="snap-title px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation()
              handleStartEdit()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="snap-title text-sm font-medium text-foreground cursor-text hover:text-primary transition-colors"
          >
            {snap.name}
          </span>
        )}
      </div>

      {/* Image */}
      <div
        className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden rounded-b-lg -m-px"
        onClick={() => onExpand(snap.id)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={snap.imageUrl}
          alt={snap.name}
          className="block rounded-b-lg"
          style={{
            width: snap.width,
            height: snap.height,
            border: 'none',
          }}
        />
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
        style={{ touchAction: 'none' }}
        onPointerDown={handleResizeStart}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-primary">
          <path d="M15 10L10 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
})

export function SnapsDisplay({ snaps, onRemoveSnap, onRenameSnap, onReorderSnaps, teacherSnaps = [], snapOverrides, onTeacherSnapOverride, zoom }: SnapsDisplayProps) {
  if (DEBUG_STATE) console.log(`[SnapsDisplay] Render - ${snaps.length} snaps, ${teacherSnaps.length} teacher snaps`)

  const [expandedSnapIndex, setExpandedSnapIndex] = useState<number | null>(null)
  const [expandedIsTeacher, setExpandedIsTeacher] = useState(false)
  const [newSnapIds, setNewSnapIds] = useState<Set<string>>(new Set())
  const prevSnapIdsRef = useRef<Set<string>>(new Set())

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: triggers animation for new snaps, cleaned up with timeout
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
    }
  }, [snaps])

  const handleTeacherSnapExpand = useCallback((id: string) => {
    const index = teacherSnaps.findIndex(s => s.id === id)
    if (index !== -1) {
      setExpandedSnapIndex(index)
      setExpandedIsTeacher(true)
    }
  }, [teacherSnaps])

  if (snaps.length === 0 && teacherSnaps.length === 0) return null

  // Get snaps for the viewer based on which type is expanded
  const viewerSnaps = expandedIsTeacher ? teacherSnaps : snaps

  return (
    <>
      {/* Student's own snaps */}
      {snaps.map((snap) => (
        <SnapItem
          key={snap.id}
          snap={snap}
          isNew={newSnapIds.has(snap.id)}
          onRemove={onRemoveSnap}
          onRename={onRenameSnap}
          onReorder={onReorderSnaps}
          onExpand={handleExpand}
          zoom={zoom}
          allSnaps={snaps}
        />
      ))}

      {/* Teacher snaps (read-only, moveable) */}
      {teacherSnaps.map((snap) => {
        // Determine which override map to use based on layer type
        const isClassSnap = snap.layerId.startsWith('class-')
        const overrideKey = isClassSnap ? 'classSnaps' : 'feedbackSnaps'
        const layerType = isClassSnap ? 'class' : 'individual' as const
        const overridePosition = snapOverrides?.[overrideKey]?.[snap.id]

        return (
          <TeacherSnapItem
            key={snap.id}
            snap={snap}
            zoom={zoom}
            onExpand={handleTeacherSnapExpand}
            overridePosition={overridePosition}
            onPositionChange={onTeacherSnapOverride ? (pos) => onTeacherSnapOverride(snap.id, layerType, pos) : undefined}
          />
        )
      })}

      {/* Expanded snap modal */}
      {expandedSnapIndex !== null && (
        <SnapViewerOverlay
          snaps={viewerSnaps}
          initialIndex={expandedSnapIndex}
          onClose={() => {
            setExpandedSnapIndex(null)
            setExpandedIsTeacher(false)
          }}
        />
      )}
    </>
  )
}
