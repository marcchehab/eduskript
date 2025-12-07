'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight } from 'lucide-react'

export interface SnapViewerItem {
  id: string
  name: string
  imageUrl: string
  width: number
  height: number
}

interface SnapViewerOverlayProps<T extends SnapViewerItem> {
  snaps: T[]
  initialIndex: number
  onClose: () => void
  /** Called when navigating to track which snap is being viewed */
  onIndexChange?: (index: number) => void
  /** Optional subtitle below the name */
  renderSubtitle?: (snap: T, index: number, total: number) => ReactNode
  /** Optional content for bottom-left corner (e.g., "View page" button) */
  renderBottomLeft?: (snap: T) => ReactNode
  /** Optional content for bottom-right corner (replaces default dimensions) */
  renderBottomRight?: (snap: T) => ReactNode
}

export function SnapViewerOverlay<T extends SnapViewerItem>({
  snaps,
  initialIndex,
  onClose,
  onIndexChange,
  renderSubtitle,
  renderBottomLeft,
  renderBottomRight,
}: SnapViewerOverlayProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [zoomLevel, setZoomLevel] = useState(1)

  const currentSnap = snaps[currentIndex]

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1
      setCurrentIndex(newIndex)
      setZoomLevel(1)
      onIndexChange?.(newIndex)
    }
  }, [currentIndex, onIndexChange])

  const goToNext = useCallback(() => {
    if (currentIndex < snaps.length - 1) {
      const newIndex = currentIndex + 1
      setCurrentIndex(newIndex)
      setZoomLevel(1)
      onIndexChange?.(newIndex)
    }
  }, [currentIndex, snaps.length, onIndexChange])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 'ArrowLeft') {
        goToPrev()
      } else if (e.key === 'ArrowRight') {
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, goToPrev, goToNext])

  if (!currentSnap) return null

  const overlay = (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={handleClose}
    >
      {/* Top bar with controls */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
        {/* Info - left */}
        <div className="bg-background/80 backdrop-blur rounded-lg px-4 py-2">
          <h3 className="font-semibold text-foreground">
            {currentSnap.name}
          </h3>
          {renderSubtitle ? (
            renderSubtitle(currentSnap, currentIndex, snaps.length)
          ) : snaps.length > 1 ? (
            <p className="text-sm text-muted-foreground">
              {currentIndex + 1} / {snaps.length}
            </p>
          ) : null}
        </div>

        {/* Controls - right */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.max(0.25, z - 0.25)) }}
            className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="bg-background/80 backdrop-blur rounded-lg px-3 py-1 text-sm min-w-[4rem] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.min(4, z + 0.25)) }}
            className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <a
            href={currentSnap.imageUrl}
            download={`${currentSnap.name}.jpg`}
            onClick={(e) => e.stopPropagation()}
            className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
            title="Download"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            onClick={handleClose}
            className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Previous button - left side */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors z-10"
          title="Previous (←)"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Next button - right side */}
      {currentIndex < snaps.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToNext() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors z-10"
          title="Next (→)"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Bottom left - custom content */}
      {renderBottomLeft && (
        <div className="absolute bottom-4 left-4 z-10">
          {renderBottomLeft(currentSnap)}
        </div>
      )}

      {/* Bottom right - custom or default dimensions */}
      <div className="absolute bottom-4 right-4 bg-background/80 backdrop-blur rounded-lg px-3 py-1 text-sm text-muted-foreground z-10">
        {renderBottomRight ? renderBottomRight(currentSnap) : (
          <>{Math.round(currentSnap.width)} x {Math.round(currentSnap.height)}</>
        )}
      </div>

      {/* Image - fills available space */}
      <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentSnap.imageUrl}
          alt={currentSnap.name}
          className="object-contain transition-transform duration-200"
          style={{
            transform: `scale(${zoomLevel})`,
            minWidth: '50vw',
            maxWidth: zoomLevel <= 1 ? '100%' : 'none',
            maxHeight: zoomLevel <= 1 ? '100%' : 'none'
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null

  return createPortal(overlay, document.body)
}
