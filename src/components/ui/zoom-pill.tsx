'use client'

import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

/**
 * Pill-shaped "− | +" control for text-size changes. Used by the sidebar
 * FontSizeControls and by the code editor (editor pane + output panel).
 * Purely presentational: state and clamping live in the caller.
 */
interface ZoomPillProps {
  onDecrease: () => void
  onIncrease: () => void
  canDecrease?: boolean
  canIncrease?: boolean
  orientation?: 'horizontal' | 'vertical'
  /** 'md' = sidebar (16px icons), 'sm' = compact editor toolbars (12px icons) */
  size?: 'sm' | 'md'
  decreaseTitle?: string
  increaseTitle?: string
  /** Optional middle segment (e.g. dev-only size readout) */
  children?: ReactNode
  className?: string
}

export function ZoomPill({
  onDecrease,
  onIncrease,
  canDecrease = true,
  canIncrease = true,
  orientation = 'horizontal',
  size = 'md',
  decreaseTitle = 'Decrease text size',
  increaseTitle = 'Increase text size',
  children,
  className = '',
}: ZoomPillProps) {
  const isVertical = orientation === 'vertical'
  const button = size === 'sm' ? 'px-1.5 py-1' : 'p-2'
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const divider = isVertical
    ? 'h-px w-4 bg-border mx-auto'
    : `w-px ${size === 'sm' ? 'h-3' : 'h-4'} bg-border`

  return (
    <div className={`flex border border-border bg-card ${
      isVertical ? 'flex-col rounded-lg' : 'items-center rounded-full'
    } ${className}`}>
      <button
        type="button"
        onClick={onDecrease}
        disabled={!canDecrease}
        title={decreaseTitle}
        className={`${button} hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isVertical ? 'rounded-t-lg' : 'rounded-l-full'
        }`}
      >
        <Minus className={icon} />
      </button>

      <div className={divider} />

      {children && (
        <>
          {children}
          <div className={divider} />
        </>
      )}

      <button
        type="button"
        onClick={onIncrease}
        disabled={!canIncrease}
        title={increaseTitle}
        className={`${button} hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isVertical ? 'rounded-b-lg' : 'rounded-r-full'
        }`}
      >
        <Plus className={icon} />
      </button>
    </div>
  )
}
