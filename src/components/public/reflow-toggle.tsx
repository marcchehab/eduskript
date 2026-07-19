'use client'

import { AlignLeft, NotebookPen } from 'lucide-react'
import { useReflowMode } from '@/hooks/use-reflow-mode'

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
        <NotebookPen className="w-4 h-4 text-foreground" />
      ) : (
        <AlignLeft className="w-4 h-4 text-foreground" />
      )}
    </button>
  )
}
