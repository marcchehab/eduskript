'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, GripVertical, Trash2 } from 'lucide-react'
import type { Snap } from './snap-overlay'
import Image from 'next/image'

interface SnapsDisplayProps {
  snaps: Snap[]
  onRemoveSnap: (id: string) => void
  onRenameSnap: (id: string, newName: string) => void
  onReorderSnaps: (snaps: Snap[]) => void
  zoom: number
}

export function SnapsDisplay({ snaps, onRemoveSnap, onRenameSnap, onReorderSnaps, zoom }: SnapsDisplayProps) {
  const [editingSnapId, setEditingSnapId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [expandedSnapId, setExpandedSnapId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStart = useRef({ x: 0, y: 0 })
  const [resizingId, setResizingId] = useState<string | null>(null)
  const [resizeDelta, setResizeDelta] = useState({ width: 0, height: 0 })
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 })

  const handleStartEdit = (snap: Snap) => {
    setEditingSnapId(snap.id)
    setEditName(snap.name)
  }

  const handleSaveEdit = (id: string) => {
    if (editName.trim()) {
      onRenameSnap(id, editName.trim())
    }
    setEditingSnapId(null)
    setEditName('')
  }

  const handleCancelEdit = () => {
    setEditingSnapId(null)
    setEditName('')
  }

  const handleToggleExpand = (id: string) => {
    setExpandedSnapId(prev => prev === id ? null : id)
  }

  const handleDragStart = (e: React.MouseEvent, snapId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingId(snapId)
    dragStart.current = { x: e.clientX, y: e.clientY }
    setDragOffset({ x: 0, y: 0 })
  }

  const handleDragMove = useCallback((e: MouseEvent) => {
    const offsetX = (e.clientX - dragStart.current.x) / zoom
    const offsetY = (e.clientY - dragStart.current.y) / zoom
    setDragOffset({ x: offsetX, y: offsetY })
  }, [zoom])

  const handleDragEnd = useCallback(() => {
    setDragOffset(currentOffset => {
      // Ignore tiny movements
      if (Math.abs(currentOffset.x) < 5 && Math.abs(currentOffset.y) < 5) {
        setDraggingId(null)
        return { x: 0, y: 0 }
      }

      const draggedIndex = snaps.findIndex(s => s.id === draggingId)
      if (draggedIndex === -1) {
        setDraggingId(null)
        return { x: 0, y: 0 }
      }

      // Update the snap's position (both left and top)
      const newSnaps = snaps.map((snap, idx) => {
        if (idx === draggedIndex) {
          return {
            ...snap,
            left: snap.left + currentOffset.x,
            top: snap.top + currentOffset.y
          }
        }
        return snap
      })

      onReorderSnaps(newSnaps)

      setDraggingId(null)
      return { x: 0, y: 0 }
    })
  }, [draggingId, snaps, onReorderSnaps])

  const handleResizeStart = (e: React.MouseEvent, snap: Snap) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingId(snap.id)
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: snap.width,
      height: snap.height
    }
    setResizeDelta({ width: 0, height: 0 })
  }

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const deltaX = (e.clientX - resizeStart.current.x) / zoom
    const deltaY = (e.clientY - resizeStart.current.y) / zoom
    setResizeDelta({ width: deltaX, height: deltaY })
  }, [zoom])

  const handleResizeEnd = useCallback(() => {
    setResizeDelta(currentDelta => {
      const resizedIndex = snaps.findIndex(s => s.id === resizingId)
      if (resizedIndex === -1) {
        setResizingId(null)
        return { width: 0, height: 0 }
      }

      const snap = snaps[resizedIndex]
      const newWidth = Math.max(100, snap.width + currentDelta.width)
      const newHeight = Math.max(75, snap.height + currentDelta.height)

      // Update the snap's dimensions
      const newSnaps = snaps.map((s, idx) => {
        if (idx === resizedIndex) {
          return {
            ...s,
            width: newWidth,
            height: newHeight
          }
        }
        return s
      })

      onReorderSnaps(newSnaps)

      setResizingId(null)
      return { width: 0, height: 0 }
    })
  }, [resizingId, snaps, onReorderSnaps])

  // Add/remove mouse event listeners for dragging
  useEffect(() => {
    if (draggingId) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
      return () => {
        window.removeEventListener('mousemove', handleDragMove)
        window.removeEventListener('mouseup', handleDragEnd)
      }
    }
  }, [draggingId, handleDragMove, handleDragEnd])

  // Add/remove mouse event listeners for resizing
  useEffect(() => {
    if (resizingId) {
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleResizeEnd)
      return () => {
        window.removeEventListener('mousemove', handleResizeMove)
        window.removeEventListener('mouseup', handleResizeEnd)
      }
    }
  }, [resizingId, handleResizeMove, handleResizeEnd])

  const expandedSnap = snaps.find(s => s.id === expandedSnapId)

  if (snaps.length === 0) return null

  return (
    <>
      {snaps.map((snap, index) => {
        const isDragging = draggingId === snap.id
        const isResizing = resizingId === snap.id
        const transform = isDragging ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : 'none'
        const displayWidth = isResizing ? snap.width + resizeDelta.width : snap.width
        const displayHeight = isResizing ? snap.height + resizeDelta.height : snap.height

        return (
          <div
            key={snap.id}
            className="absolute z-40 bg-background border-2 border-primary shadow-lg rounded-lg overflow-hidden group transition-shadow"
            style={{
              top: `${snap.top}px`,
              left: `${snap.left}px`,
              width: `${displayWidth}px`,
              transform,
              opacity: isDragging || isResizing ? 0.8 : 1,
              boxShadow: isDragging || isResizing ? '0 10px 30px rgba(0,0,0,0.3)' : undefined,
            }}
          >
            {/* Control buttons */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              {/* Remove button */}
              <button
                onClick={() => onRemoveSnap(snap.id)}
                className="p-1 bg-background/90 backdrop-blur border border-border rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Remove snap"
                aria-label="Remove this snap"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Snap name/title with drag handle */}
            <div
              className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2 cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => {
                // Only start drag if not clicking on the title text or input
                const target = e.target as HTMLElement
                if (!target.closest('.snap-title')) {
                  handleDragStart(e, snap.id)
                }
              }}
            >
              {/* Drag handle icon */}
              <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />

              {/* Name input/display */}
              {editingSnapId === snap.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveEdit(snap.id)
                    } else if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                  onBlur={() => handleSaveEdit(snap.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="snap-title px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              ) : (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartEdit(snap)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="snap-title text-sm font-medium text-foreground cursor-text hover:text-primary transition-colors"
                  title="Click to rename"
                >
                  {snap.name}
                </span>
              )}
            </div>

            {/* Captured image */}
            <div
              className="relative cursor-pointer hover:opacity-90 transition-opacity overflow-hidden rounded-b-lg -m-px"
              onClick={() => handleToggleExpand(snap.id)}
              title="Click to expand"
            >
              <Image
                src={snap.imageUrl}
                alt={snap.name}
                width={displayWidth}
                height={displayHeight}
                className="w-full h-auto block rounded-b-lg"
                style={{
                  border: 'none',
                  display: 'block',
                }}
                unoptimized
              />
            </div>

            {/* Resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
              onMouseDown={(e) => handleResizeStart(e, snap)}
              title="Drag to resize"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-primary"
              >
                <path
                  d="M15 10L10 15M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>

          </div>
        )
      })}

      {/* Expanded snap modal - rendered via portal to avoid transform issues */}
      {expandedSnap && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setExpandedSnapId(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] bg-background border-2 border-primary rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
              <h3 className="text-lg font-semibold text-foreground">{expandedSnap.name}</h3>
              <button
                onClick={() => setExpandedSnapId(null)}
                className="p-2 hover:bg-accent rounded-md transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Expanded image */}
            <div className="overflow-auto max-h-[calc(90vh-4rem)]">
              <img
                src={expandedSnap.imageUrl}
                alt={expandedSnap.name}
                className="w-auto h-auto max-w-full"
              />
            </div>

            {/* Footer info */}
            <div className="px-4 py-2 bg-muted/30 border-t border-border text-sm text-muted-foreground text-center">
              {expandedSnap.width} × {expandedSnap.height} pixels
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
