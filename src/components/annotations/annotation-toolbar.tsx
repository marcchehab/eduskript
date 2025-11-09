'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pen, Eraser, Trash2, Eye, EyeOff } from 'lucide-react'
import { Circle } from '@uiw/react-color'
import Image from 'next/image'
import brushThickIcon from './brush_thick.png'
import brushThinIcon from './brush_thin.png'

export type AnnotationMode = 'view' | 'draw' | 'erase'

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
  onPenSizeChange
}: AnnotationToolbarProps) {
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
        onClick={() => onModeChange(mode === 'erase' ? 'view' : 'erase')}
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
        <button
          onClick={() => {
            if (confirm('Clear all annotations on this page?')) {
              onClear()
            }
          }}
          className="p-3 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Clear all annotations"
          aria-label="Clear all annotations"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      )}

    </div>
  )

  // Render to document.body to avoid zoom transforms
  return typeof window !== 'undefined' ? createPortal(toolbarContent, document.body) : toolbarContent
}
