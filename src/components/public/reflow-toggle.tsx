'use client'

import { PencilOff } from 'lucide-react'
import { useReflowMode } from '@/hooks/use-reflow-mode'

/** Portrait sheet with two text lines and a pencil. Lucide has none without a folded corner. */
function SheetPen({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 11V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4.5" />
      <path d="M8 7h8" />
      <path d="M8 11h4" />
      <path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </svg>
  )
}

/**
 * Toggles reflow ("reading") mode — drops the annotation system + fixed paper
 * so content reflows to the viewport. Sits next to the theme toggle. Phones
 * default to on; anyone can flip it. State lives in useReflowMode.
 */
export function ReflowToggle() {
  const { reflow, mounted, toggle } = useReflowMode()

  // Mirror PublicThemeToggle: render an inert placeholder until mounted so the
  // icon doesn't flip on hydration.
  if (!mounted) {
    return (
      <button className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors">
        <div className="w-4 h-4" />
      </button>
    )
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors"
      title={reflow ? 'Show annotations & page layout' : 'Reading mode (reflow text, hide annotations)'}
    >
      {reflow ? (
        <SheetPen className="w-4 h-4 text-foreground" />
      ) : (
        <PencilOff className="w-4 h-4 text-foreground" />
      )}
    </button>
  )
}
