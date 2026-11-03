'use client'

import { useRef, useState, Children, type ReactNode } from 'react'
import { usePrintState } from '@/lib/print/print-mode'
import { nodeText, useRegisterSolution } from '@/lib/print/solutions'
import { SolutionPrintLine } from '@/components/markdown/solution'
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  AlertCircle,
  Lightbulb,
  HelpCircle,
  X,
  Bug,
  FileText,
  Quote,
  Sparkles,
  MessageCircle,
  ListTodo,
  ChevronRight,
  Bot,
} from 'lucide-react'

// Icon mapping for callout types
const calloutIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  note: FileText,
  abstract: FileText,
  info: Info,
  tip: Lightbulb,
  success: CheckCircle2,
  question: HelpCircle,
  warning: AlertTriangle,
  failure: X,
  danger: AlertCircle,
  bug: Bug,
  example: Sparkles,
  quote: Quote,
  solution: CheckCircle2,
  discuss: MessageCircle,
  todo: ListTodo,
  mop7: Bot,
}

interface CalloutProps {
  children: ReactNode
  className?: string
  type?: string
  isFoldable?: boolean
  initiallyFolded?: boolean
  sectionId?: string  // For annotation alignment tracking
  sourceLineStart?: string  // Editor preview cursor-sync
  sourceLineEnd?: string
}

export function Callout({ children, className, type, isFoldable, initiallyFolded, sectionId, sourceLineStart, sourceLineEnd }: CalloutProps) {
  const [isOpen, setIsOpen] = useState(!initiallyFolded)

  // Print view: a [!solution] callout moves to the end, like <solution>. It
  // stays in place folded, its title pointing to the end; overflow clip cuts
  // strokes drawn on its content online. Callouts are always visible online
  // (also on exam pages), so solution mode 'online' prints them.
  const { active: printing, solutions } = usePrintState()
  const isSolution = type === 'solution'
  const solutionInPrint = isSolution && solutions !== 'none'
  const anchor = useRef<HTMLQuoteElement>(null)
  const kids = Children.toArray(children)
  const isTitle = (c: unknown) =>
    typeof c === 'object' && c !== null && 'props' in c &&
    !!(c as { props: { className?: string } }).props.className?.includes('callout-title')
  const titleNode = kids.find(isTitle) as { props: { children?: ReactNode } } | undefined
  const titleText = titleNode ? nodeText(titleNode.props.children).trim() : undefined
  const n = useRegisterSolution(printing && solutionInPrint, anchor, kids.filter((c) => !isTitle(c)), titleText)
  // Other folded callouts open in print: the folded content would be lost on
  // paper. Strokes after the callout follow it (its -end section sentinel).
  const open = printing ? !isSolution : isOpen
  const foldable = isFoldable || (printing && isSolution)

  const Icon = type ? calloutIcons[type] : null

  const handleToggle = (e: React.MouseEvent) => {
    if (!isFoldable) return

    // Only toggle when the click landed on the callout's title bar.
    // The blockquote is also the section's annotation portal target, so
    // sticky notes / stroke SVGs / snaps end up as direct children. Without
    // this guard, clicking a sticky note inside a callout bubbles up here
    // and folds the callout instead of selecting the note.
    const target = e.target as HTMLElement
    if (!target.closest('.callout-title')) return

    setIsOpen(!isOpen)
  }

  // Build className without the folded state (we control it via React state)
  const baseClassName = className?.replace(/\s*callout-folded\s*/g, ' ').trim()
  if (printing && isSolution && !solutionInPrint) return null
  // Printed like <solution>: one line instead of the gray folded callout bar.
  // Slightly lower than the folded bar online, so strokes below it on the
  // same section move up by a few px.
  if (printing && isSolution) {
    return (
      <blockquote
        ref={anchor}
        data-print-keep=""
        data-section-id={sectionId}
        data-source-line-start={sourceLineStart}
        data-source-line-end={sourceLineEnd}
        className="my-4 rounded-lg !border !border-green-600/30 !px-4 !py-2"
        style={{ fontStyle: 'normal', quotes: 'none' }}
      >
        <SolutionPrintLine label={n} />
      </blockquote>
    )
  }

  return (
    <blockquote
      ref={anchor}
      className={`${baseClassName}${foldable ? ' callout-foldable' : ''} ${!open && foldable ? 'callout-folded' : ''}`}
      onClick={handleToggle}
      style={{ cursor: isFoldable ? 'pointer' : undefined, overflow: printing && isSolution ? 'clip' : undefined }}
      data-print-keep={printing && isSolution ? '' : undefined}
      data-section-id={sectionId}
      data-source-line-start={sourceLineStart}
      data-source-line-end={sourceLineEnd}
      data-dynamic-height={isFoldable ? 'true' : undefined}
    >
      {/* Process children to inject icon into callout-title */}
      {Children.toArray(children).map((child, i) => {
        if (typeof child === 'object' && child !== null && 'props' in child) {
          const childProps = (child as { props: { className?: string; children?: ReactNode } }).props
          if (childProps.className?.includes('callout-title')) {
            return (
              <div key={i} className={childProps.className}>
                <div className="flex items-center gap-2 w-full">
                  {Icon && <Icon className="w-5 h-5 shrink-0" />}
                  <span className="flex-1">
                    {childProps.children}
                  </span>
                  {isFoldable && (
                    <ChevronRight
                      className={`w-5 h-5 shrink-0 transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
                    />
                  )}
                </div>
              </div>
            )
          }
        }
        return child
      })}
    </blockquote>
  )
}
