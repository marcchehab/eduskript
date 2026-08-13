/**
 * Wraps a UI control and points at it (pulsing ring + bouncing label) when
 * it's the target for the current next-incomplete onboarding quest step —
 * the same "nudge toward the next action" idea as EmptyPageDragHint
 * (src/components/dashboard/empty-page-drag-hint.tsx), but for a single
 * on-page target instead of a cross-component drag source/drop-zone line.
 * Renders children unchanged (no wrapper, no hooks cost beyond the cheap
 * session check) once that step is done or for non-teacher sessions.
 */
'use client'

import { useNextIncompleteStep } from '@/lib/onboarding-quest/use-quest-step'
import type { QuestStep } from '@/lib/onboarding-quest/types'

interface QuestSpotlightProps {
  step: QuestStep
  label: string
  children: React.ReactNode
}

export function QuestSpotlight({ step, label, children }: QuestSpotlightProps) {
  const next = useNextIncompleteStep()
  if (next !== step) return <>{children}</>

  return (
    <span className="relative inline-flex">
      {children}
      <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-blue-400 animate-pulse" />
      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-full bg-blue-500 text-white text-xs font-medium px-2 py-0.5 shadow-lg animate-bounce">
        {label}
      </span>
    </span>
  )
}
