'use client'

import { useRef, useState } from 'react'
import { Pen, Eraser, Trash2 } from 'lucide-react'
import { Circle } from '@uiw/react-color'
import { cn } from '@/lib/utils'

export type SlideDrawMode = 'view' | 'draw' | 'erase'

/** Palette + brush icons mirror the page annotation toolbar so the presenter's
 *  drawing controls feel identical. */
const PALETTE = ['#000000', '#808080', '#DD5555', '#EE8844', '#44AA66', '#5577DD', '#9966DD']

function BrushThickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 95.1 55.3" className={className} fill="currentColor" aria-hidden="true">
      <path d="m 5.28,37.02 c -8.35,-6.1 5.09,-22.53 18.72,-22.1 20.18,0.63 32.97,26.23 53.83,21.66 5.7,-1.25 10.45,-4.36 13.6,-6.76 -10.15,10.24 -19.28,11.66 -25.65,11.64 -15.84,-0.04 -28.81,-10.07 -39.55,-10.07 -6.54,0 -15.92,9.3 -20.95,5.63 z" />
    </svg>
  )
}
function BrushThinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 95.1 55.3" className={className} fill="currentColor" aria-hidden="true">
      <path d="m 176.44,128.54 c -1.61,-2.99 11.93,-12.25 22.02,-12.14 17.74,0.58 33.83,14.77 50.55,14.55 4.74,-0.22 11.01,-1.9 18.49,-8.11 -10.3,9.54 -18.15,9.77 -23.17,9.75 -9.22,-0.04 -33.96,-11.68 -46.1,-11.89 -11.13,-0.19 -20.17,10.83 -21.79,7.84 z" transform="translate(-174.16,-95.58)" />
    </svg>
  )
}

interface SlideToolbarProps {
  mode: SlideDrawMode
  onModeChange: (mode: SlideDrawMode) => void
  activePen: number
  onActivePenChange: (penIndex: number) => void
  penColors: [string, string, string]
  onPenColorChange: (penIndex: number, color: string) => void
  penSizes: [number, number, number]
  onPenSizeChange: (penIndex: number, size: number) => void
  onClear: () => void
}

/**
 * Drawing toolbar for the slide presenter. Standalone (not the page annotation
 * toolbar) but styled to match it: a bottom-center pill with three pens (each
 * with a hover color/size popover), an eraser, and a clear button. Drives the
 * presenter's local, ephemeral SlideDrawLayer — no persistence, no page
 * annotations, and none of the page toolbar's divider / sticky-note / personal-
 * notes tools.
 */
export function SlideToolbar({
  mode,
  onModeChange,
  activePen,
  onActivePenChange,
  penColors,
  onPenColorChange,
  penSizes,
  onPenSizeChange,
  onClear,
}: SlideToolbarProps) {
  const [openPen, setOpenPen] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (i: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setOpenPen(i)
  }
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setOpenPen(null), 150)
  }

  const handlePenClick = (i: number) => {
    // Clicking the active pen toggles back to view (so the slide stays clickable).
    if (mode === 'draw' && activePen === i) onModeChange('view')
    else {
      onActivePenChange(i)
      onModeChange('draw')
    }
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-61 select-none"
      style={{ touchAction: 'manipulation' }}
    >
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-2 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative" onMouseEnter={() => show(i)} onMouseLeave={scheduleHide}>
            <button
              onClick={() => handlePenClick(i)}
              className={cn(
                'p-2 rounded-md transition-colors relative',
                mode === 'draw' && activePen === i
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title={`Pen ${i + 1}`}
              aria-label={`Select pen ${i + 1}`}
            >
              <Pen className="w-4 h-4" />
              <div
                className="annotation-color-indicator absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-white dark:border-gray-800"
                style={{ backgroundColor: penColors[i] }}
              />
            </button>

            {openPen === i && (
              <div
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex gap-2"
                onMouseEnter={() => show(i)}
                onMouseLeave={scheduleHide}
              >
                <div className="bg-background border border-border rounded-lg shadow-lg p-3 flex flex-col items-center gap-3 min-h-[200px]">
                  <BrushThickIcon className="w-6 h-6 shrink-0 opacity-60" />
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={penSizes[i]}
                    onChange={(e) => onPenSizeChange(i, parseFloat(e.target.value))}
                    className="grow cursor-pointer [writing-mode:vertical-lr] [direction:rtl] slider-vertical"
                  />
                  <BrushThinIcon className="w-6 h-6 shrink-0 opacity-60" />
                </div>
                <div className="bg-background border border-border rounded-lg shadow-lg p-3 annotation-color-picker">
                  <Circle
                    colors={PALETTE}
                    color={penColors[i]}
                    onChange={(c) => onPenColorChange(i, c.hex)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={() => onModeChange(mode === 'erase' ? 'view' : 'erase')}
          className={cn(
            'p-2 rounded-md transition-colors',
            mode === 'erase'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
          title="Erase"
        >
          <Eraser className="w-4 h-4" />
        </button>

        <button
          onClick={onClear}
          className="p-2 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Clear drawing on this slide"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
