'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pen, Eraser, Trash2, Eye, EyeOff, Camera } from 'lucide-react'
import { Circle } from '@uiw/react-color'
import Image from 'next/image'
import brushThickIcon from './brush_thick.png'
import brushThinIcon from './brush_thin.png'

export type AnnotationMode = 'view' | 'draw' | 'erase' | 'snap'

interface AnnotationToolbarProps {
  mode: AnnotationMode
  onModeChange: (mode: AnnotationMode) => void
  onClear: () => void
  hasAnnotations: boolean
  activePen: number
  onPenChange: (penIndex: number) => void
  penColors: [string, string, string]
  onPenColorChange: (penIndex: number, color: string) => void
  penSizes: [number, number, number]
  onPenSizeChange: (penIndex: number, size: number) => void
  zoom: number
  onResetZoom: () => void
}

export function AnnotationToolbar({
  mode,
  onModeChange,
  onClear,
  hasAnnotations,
  activePen,
  onPenChange,
  penColors,
  onPenColorChange,
  penSizes,
  onPenSizeChange,
  zoom,
  onResetZoom
}: AnnotationToolbarProps) {
  // Save confirm preference to localStorage
  const handleToggleConfirm = (value: boolean) => {
    setConfirmBeforeDelete(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-confirm-delete', value.toString())
    }
  }

  const handleColorChange = (penIndex: number, color: string) => {
    onPenColorChange(penIndex, color)
    onPenChange(penIndex)
    if (mode !== 'draw') {
      onModeChange('draw')
    }
  }

  const handleSizeChange = (penIndex: number, size: number) => {
    onPenSizeChange(penIndex, size)
    onPenChange(penIndex)
    if (mode !== 'draw') {
      onModeChange('draw')
    }
  }

  const [showPenControls, setShowPenControls] = useState<number | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [showDeleteControls, setShowDeleteControls] = useState(false)
  const deleteHoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const deleteHideTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [confirmBeforeDelete, setConfirmBeforeDelete] = useState<boolean>(() => {
    // Load preference from localStorage - default is false (no popup)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('annotation-confirm-delete')
      if (saved !== null) {
        return saved === 'true'
      }
    }
    return false
  })

  const [showSnapControls, setShowSnapControls] = useState(false)
  const snapHoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const snapHideTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Allow snapping at any zoom level
  const snapDisabled = false

  const handlePenMouseEnter = (penIndex: number) => {
    // Clear any pending hide timer
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    // Set timer to show pen controls
    hoverTimerRef.current = setTimeout(() => {
      setShowPenControls(penIndex)
    }, 300)
  }

  const handlePenMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // If pen controls are showing, delay hiding them to give user time to move into them
    if (showPenControls !== null) {
      hideTimerRef.current = setTimeout(() => {
        setShowPenControls(null)
      }, 200)
    }
  }

  const handlePenClick = (penIndex: number) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setShowPenControls(null)
    onPenChange(penIndex)
    if (mode !== 'draw') {
      onModeChange('draw')
    }
  }

  const handleEraserClick = () => {
    onModeChange(mode === 'erase' ? 'view' : 'erase')
  }

  const handleDeleteMouseEnter = () => {
    // Clear any pending hide timer
    if (deleteHideTimerRef.current) {
      clearTimeout(deleteHideTimerRef.current)
      deleteHideTimerRef.current = null
    }

    // Set timer to show delete controls
    deleteHoverTimerRef.current = setTimeout(() => {
      setShowDeleteControls(true)
    }, 300)
  }

  const handleDeleteMouseLeave = () => {
    if (deleteHoverTimerRef.current) {
      clearTimeout(deleteHoverTimerRef.current)
      deleteHoverTimerRef.current = null
    }

    // If delete controls are showing, delay hiding them
    if (showDeleteControls) {
      deleteHideTimerRef.current = setTimeout(() => {
        setShowDeleteControls(false)
      }, 200)
    }
  }

  const handleDeleteClick = () => {
    if (deleteHoverTimerRef.current) {
      clearTimeout(deleteHoverTimerRef.current)
      deleteHoverTimerRef.current = null
    }
    setShowDeleteControls(false)

    if (confirmBeforeDelete) {
      if (confirm('Clear all annotations on this page?')) {
        onClear()
      }
    } else {
      onClear()
    }
  }

  const handleSnapMouseEnter = () => {
    if (!snapDisabled) return

    // Clear any pending hide timer
    if (snapHideTimerRef.current) {
      clearTimeout(snapHideTimerRef.current)
      snapHideTimerRef.current = null
    }

    // Set timer to show snap controls
    snapHoverTimerRef.current = setTimeout(() => {
      setShowSnapControls(true)
    }, 300)
  }

  const handleSnapMouseLeave = () => {
    if (snapHoverTimerRef.current) {
      clearTimeout(snapHoverTimerRef.current)
      snapHoverTimerRef.current = null
    }

    // If snap controls are showing, delay hiding them
    if (showSnapControls) {
      snapHideTimerRef.current = setTimeout(() => {
        setShowSnapControls(false)
      }, 200)
    }
  }

  const handleSnapClick = () => {
    if (snapDisabled) return
    onModeChange(mode === 'snap' ? 'view' : 'snap')
  }

  const toolbarContent = (
    <div className="fixed bottom-6 right-6 z-50 bg-background/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 flex flex-col gap-1" style={{ isolation: 'isolate' }}>
      {/* Three Pen Tools */}
      {[0, 1, 2].map((penIndex) => (
        <div key={penIndex} className="relative">
          <button
            onClick={() => handlePenClick(penIndex)}
            onMouseEnter={() => handlePenMouseEnter(penIndex)}
            onMouseLeave={handlePenMouseLeave}
            className={`p-3 rounded-md transition-colors relative ${
              mode === 'draw' && activePen === penIndex
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            title={`Pen ${penIndex + 1}`}
            aria-label={`Select pen ${penIndex + 1}`}
          >
            <Pen className="w-5 h-5" />
            {/* Color indicator */}
            <div
              className="annotation-color-indicator absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-white"
              style={{ backgroundColor: penColors[penIndex] }}
            />
          </button>

          {/* Pen controls popover (size slider + color picker) */}
          {showPenControls === penIndex && (
            <div
              className="absolute right-full mr-2 bottom-0 flex gap-2"
              onMouseEnter={() => {
                if (hoverTimerRef.current) {
                  clearTimeout(hoverTimerRef.current)
                }
                if (hideTimerRef.current) {
                  clearTimeout(hideTimerRef.current)
                  hideTimerRef.current = null
                }
              }}
              onMouseLeave={() => setShowPenControls(null)}
            >
              {/* Size slider */}
              <div className="bg-background border border-border rounded-full shadow-lg p-3 flex flex-col items-center gap-3 h-full min-h-[200px]">
                {/* Thick brush icon (top) */}
                <Image
                  src={brushThickIcon}
                  alt="Thick brush"
                  width={16}
                  height={16}
                  className="flex-shrink-0 opacity-60"
                />

                {/* Vertical slider */}
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={penSizes[penIndex]}
                  onChange={(e) => handleSizeChange(penIndex, parseFloat(e.target.value))}
                  className="flex-grow cursor-pointer [writing-mode:vertical-lr] [direction:rtl] slider-vertical"
                />

                {/* Thin brush icon (bottom) */}
                <Image
                  src={brushThinIcon}
                  alt="Thin brush"
                  width={16}
                  height={16}
                  className="flex-shrink-0 opacity-60"
                />
              </div>

              {/* Color picker */}
              <div className="bg-background border border-border rounded-full shadow-lg p-3 annotation-color-picker">
                <Circle
                  colors={['#000000', '#808080', '#DD5555', '#EE8844', '#44AA66', '#5577DD', '#9966DD']}
                  color={penColors[penIndex]}
                  onChange={(color) => handleColorChange(penIndex, color.hex)}
                />
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Eraser Tool */}
      <button
        onClick={handleEraserClick}
        className={`p-3 rounded-md transition-colors ${
          mode === 'erase'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title="Erase"
        aria-label="Toggle eraser mode"
      >
        <Eraser className="w-5 h-5" />
      </button>

      {/* Snap Tool */}
      <div
        className="relative"
        onMouseEnter={handleSnapMouseEnter}
        onMouseLeave={handleSnapMouseLeave}
      >
        <button
          onClick={handleSnapClick}
          disabled={snapDisabled}
          className={`p-3 rounded-md transition-colors relative ${
            snapDisabled
              ? 'opacity-50 cursor-not-allowed text-muted-foreground'
              : mode === 'snap'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
          title={snapDisabled ? "Zoom must be at 1.0 to capture snaps" : "Capture screenshot"}
          aria-label="Toggle snap mode"
        >
          <Camera className="w-5 h-5" />
          {snapDisabled && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <svg className="w-6 h-6 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </div>
          )}
        </button>

        {/* Snap controls popup */}
        {showSnapControls && snapDisabled && (
          <div
            className="absolute right-full mr-2 bottom-0"
            onMouseEnter={() => {
              if (snapHoverTimerRef.current) {
                clearTimeout(snapHoverTimerRef.current)
              }
              if (snapHideTimerRef.current) {
                clearTimeout(snapHideTimerRef.current)
                snapHideTimerRef.current = null
              }
            }}
            onMouseLeave={() => setShowSnapControls(false)}
          >
            <div className="bg-background border border-border rounded-lg shadow-lg p-3 whitespace-nowrap">
              <div className="text-xs text-foreground mb-2">
                Snapping only works without zoom
              </div>
              <button
                onClick={() => {
                  onResetZoom()
                  setShowSnapControls(false)
                }}
                className="w-full px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-xs transition-colors"
              >
                Reset zoom
              </button>
            </div>
          </div>
        )}
      </div>

      {/* View/Hide Annotations */}
      <button
        onClick={() => onModeChange('view')}
        className={`p-3 rounded-md transition-colors ${
          mode === 'view'
            ? 'text-foreground bg-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title={mode === 'view' ? 'Viewing' : 'Exit annotation mode'}
        aria-label="Toggle view mode"
      >
        {mode === 'view' ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
      </button>

      {/* Divider */}
      {hasAnnotations && <div className="h-px bg-border my-1" />}

      {/* Clear All */}
      {hasAnnotations && (
        <div className="relative">
          <button
            onClick={handleDeleteClick}
            onMouseEnter={handleDeleteMouseEnter}
            onMouseLeave={handleDeleteMouseLeave}
            className="p-3 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Clear all annotations"
            aria-label="Clear all annotations"
          >
            <Trash2 className="w-5 h-5" />
          </button>

          {/* Delete confirmation toggle popup */}
          {showDeleteControls && (
            <div
              className="absolute right-full mr-2 bottom-0"
              onMouseEnter={() => {
                if (deleteHoverTimerRef.current) {
                  clearTimeout(deleteHoverTimerRef.current)
                }
                if (deleteHideTimerRef.current) {
                  clearTimeout(deleteHideTimerRef.current)
                  deleteHideTimerRef.current = null
                }
              }}
              onMouseLeave={() => setShowDeleteControls(false)}
            >
              <div className="bg-background border border-border rounded-lg shadow-lg p-3 whitespace-nowrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-foreground">Confirm deletion</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={confirmBeforeDelete}
                    onClick={() => handleToggleConfirm(!confirmBeforeDelete)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      confirmBeforeDelete ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        confirmBeforeDelete ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )

  // Render to document.body to avoid zoom transforms
  return typeof window !== 'undefined' ? createPortal(toolbarContent, document.body) : toolbarContent
}
