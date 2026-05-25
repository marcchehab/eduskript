'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useSyncedUserData } from '@/lib/userdata'
import { useExamReview } from '@/contexts/exam-review-context'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Button } from '@/components/ui/button'
import { ArrowRight, Lock } from 'lucide-react'
import type { StageMarker } from '@/lib/markdown-stages'

/**
 * True for content inside a stage the student has already handed in (advanced
 * past). Quiz questions and code editors read this to become read-only. Default
 * false, so nothing is locked outside a StageFlow.
 */
export const StageLockContext = createContext(false)
export function useStageLocked(): boolean {
  return useContext(StageLockContext)
}

interface StageData {
  /** Highest stage the student has unlocked. One-way: only ever increases. */
  currentStage: number
}

/**
 * Renders a `<next-stage>`-divided document as sequential, hand-in-locked
 * stages. Only stages up to the current one are shown; advancing is one-way
 * (persisted via useSyncedUserData), locks the prior stage read-only, and is
 * gated behind a confirm modal. See `splitStages` + the plan.
 *
 * Security model: later stages are passed in as already-compiled nodes (in the
 * payload) but never rendered until reached — airtight under SEB, and the lock
 * on the prior stage is what defeats running a predicted program afterward.
 */
export function StageFlow({
  pageId,
  stages,
  markers,
}: {
  pageId: string
  stages: ReactNode[]
  markers: StageMarker[]
}) {
  const { data, updateData, isLoading } = useSyncedUserData<StageData>(
    pageId,
    'exam-stages',
    { currentStage: 0 },
  )

  // Teacher grading a student, or a student viewing their own returned exam.
  // The stage gate is the student's own per-attempt state; in review it would
  // read the *viewer's* state (a teacher sits at stage 0), wrongly hiding later
  // sections. So when reviewing, reveal every stage at once, unlocked, no gate.
  const { active: reviewing } = useExamReview()

  const advance = async () => {
    const prev = data?.currentStage ?? 0
    // One-way: never decrease, never exceed the last stage.
    await updateData({ currentStage: Math.min(prev + 1, stages.length - 1) }, { immediate: true })
  }

  // Until the persisted stage loads, reveal only stage 0 — this matches SSR
  // (no client data yet) so there's no hydration mismatch and no later stage
  // flashes before we know where the student is. Reviewing shows all stages.
  const reveal = reviewing
    ? stages.length - 1
    : isLoading
      ? 0
      : Math.min(data?.currentStage ?? 0, stages.length - 1)
  const hasNext = !reviewing && reveal < stages.length - 1
  const marker = markers[reveal]

  return (
    <>
      {stages.slice(0, reveal + 1).map((node, i) => {
        // When reviewing, every stage is fully interactive (teacher grades all
        // sections; a returned-exam student just reads). Only the live exam
        // locks handed-in stages.
        const locked = !reviewing && i < reveal
        return (
          <StageLockContext.Provider key={i} value={locked}>
            {locked && (
              <div className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                <span>Section handed in — read only.</span>
              </div>
            )}
            {/* `inert` makes the whole handed-in subtree non-interactive AND
                non-focusable (blocks mouse + keyboard) while staying visible —
                so quizzes and code editors alike are read-only with no
                per-component wiring. */}
            <div className={locked ? 'opacity-70' : undefined} inert={locked}>
              {node}
            </div>
          </StageLockContext.Provider>
        )
      })}

      {hasNext && (
        <div className="my-10 flex flex-col items-center gap-2 border-t pt-8">
          {/* All strings are author-overridable via the <next-stage> attrs
              (label / title / confirm / cancel) so they can be localized. */}
          <ConfirmationDialog
            title={marker?.title ?? 'Continue to the next section?'}
            description={
              marker?.confirm ??
              "You won't be able to return to or change this section once you continue."
            }
            confirmText={marker?.label ?? 'Continue'}
            cancelText={marker?.cancel ?? 'Stay here'}
            onConfirm={advance}
            trigger={
              <Button size="lg">
                {marker?.label ?? 'Next stage'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            }
          />
        </div>
      )}
    </>
  )
}
