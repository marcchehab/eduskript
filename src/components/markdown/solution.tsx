'use client'

import { useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronRight, EyeOff } from 'lucide-react'
import { useIsExamPage } from '@/contexts/exam-page-context'
import { usePrintState } from '@/lib/print/print-mode'
import { isEmptyContent, useRegisterSolution } from '@/lib/print/solutions'
import { useCanEditPage } from '@/lib/print/can-edit'

/**
 * Whether a <solution> is visible on this page: always, except on exam pages,
 * where only people who can edit the page see it. The print view appends a
 * solution in solution mode 'online' when it is visible online, always in
 * 'all' and never in 'none' (the teacher picks the mode in the print bar).
 */
export function useSolutionVisibility(pageId?: string): { online: boolean; inPrint: boolean } {
  const isExam = useIsExamPage()
  const canEdit = useCanEditPage(pageId, isExam)
  const { solutions } = usePrintState()
  const online = !isExam || canEdit
  return { online, inPrint: solutions === 'all' || (solutions === 'online' && online) }
}

/** "Title (at the end)", the line that replaces a solution while printing. */
export function SolutionPrintLine({ label }: { label: string | null }) {
  return (
    <span className="flex items-center gap-2 text-sm text-green-700">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span className="font-medium">{label ?? 'Solution'}</span>
      <span className="text-muted-foreground">(at the end)</span>
    </span>
  )
}

/**
 * `<solution title="…">markdown</solution>`: collapsed online, moved to the
 * end in the print view. A simpler replacement for `> [!solution]-` callouts,
 * which behave the same way in print.
 *
 * In print the collapsed box stays (same height as online, so strokes below it
 * stay on their text) and its label points to the solution at the end. The
 * box keeps with the block before it (data-print-keep, print-view.tsx).
 * Strokes drawn on an opened solution online land on whatever follows the
 * collapsed box in print.
 */
export function Solution({ title, pageId, children }: { title?: string; pageId?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { active } = usePrintState()
  const visibility = useSolutionVisibility(pageId)
  const anchor = useRef<HTMLDivElement>(null)
  const empty = isEmptyContent(children)
  const n = useRegisterSolution(active && visibility.inPrint && !empty, anchor, children, title)
  const label = title ? `Solution: ${title}` : 'Solution'

  if (active) {
    if (!visibility.inPrint || empty) return null
    return (
      <div ref={anchor} data-print-keep="" className="my-4 rounded-lg border border-green-600/30 px-4 py-2">
        <SolutionPrintLine label={n} />
      </div>
    )
  }
  if (!visibility.online) return null

  return (
    <div className="my-4 rounded-lg border border-green-600/30 bg-green-500/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-green-700 dark:text-green-400"
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        <CheckCircle2 className="h-4 w-4" />
        <span>{label}</span>
      </button>
      {open && <div className="border-t border-green-600/20 px-4 py-2">{children}</div>}
    </div>
  )
}

/**
 * Editor preview of `<solution hidden>`: the content is never rendered (see
 * markdown-components.tsx); this marker shows where the block is. Print: none.
 */
export function HiddenSolutionMarker({ title }: { title?: string }) {
  return (
    <div className="print-hide not-prose my-4 flex items-center gap-2 rounded-lg border border-dashed border-green-600/40 px-4 py-2 text-sm text-muted-foreground">
      <EyeOff className="h-4 w-4 shrink-0" />
      <span>
        {title ? `Hidden solution: ${title}` : 'Hidden solution'} <span className="text-xs">(for AI feedback only, students don&apos;t see it)</span>
      </span>
    </div>
  )
}
