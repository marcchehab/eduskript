'use client'

/**
 * The single control for the exam lifecycle: Hidden → Closed → Lobby → Open.
 * Replaces the old "unlock" checkbox + separate open/lobby/closed dropdown — one
 * vocabulary, reused in the dashboard page-editor (assign ahead of time) and the
 * frontend class toolbar (drive it live). Presentational + controlled: the parent
 * persists the change via POST /api/exams/[pageId]/state.
 *
 * Meaning to students: Hidden = not in their sidebar / no entry; Closed = visible
 * but can't enter yet; Lobby = waiting room; Open = take it.
 */

import { EyeOff, Lock, DoorOpen, Unlock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExamLifecycleState } from '@/lib/exam-state'

const STEPS: {
  state: ExamLifecycleState
  label: string
  Icon: typeof EyeOff
  activeClass: string
}[] = [
  { state: 'hidden', label: 'Hidden', Icon: EyeOff, activeClass: 'bg-muted text-foreground' },
  { state: 'closed', label: 'Closed', Icon: Lock, activeClass: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
  { state: 'lobby', label: 'Lobby', Icon: DoorOpen, activeClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' },
  { state: 'open', label: 'Open', Icon: Unlock, activeClass: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
]

export function ExamStateStepper({
  value,
  onChange,
  disabled = false,
  iconsOnly = false,
  className,
}: {
  value: ExamLifecycleState
  onChange: (state: ExamLifecycleState) => void
  disabled?: boolean
  /** Hide labels (compact toolbar use); the label stays as the tooltip/aria. */
  iconsOnly?: boolean
  className?: string
}) {
  return (
    <div role="group" className={cn('inline-flex overflow-hidden rounded-md border', className)}>
      {STEPS.map((step, i) => {
        const active = value === step.state
        const Icon = step.Icon
        return (
          <button
            key={step.state}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={step.label}
            onClick={() => { if (!active) onChange(step.state) }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors',
              i > 0 && 'border-l',
              active ? step.activeClass : 'text-muted-foreground hover:bg-muted/60',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className={iconsOnly ? 'sr-only' : ''}>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}
