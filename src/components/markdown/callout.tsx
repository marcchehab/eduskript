'use client'

import { useState, Children, type ReactNode } from 'react'
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
}

interface CalloutProps {
  children: ReactNode
  className?: string
  type?: string
  isFoldable?: boolean
  initiallyFolded?: boolean
  sectionId?: string  // For annotation alignment tracking
}

export function Callout({ children, className, type, isFoldable, initiallyFolded, sectionId }: CalloutProps) {
  const [isOpen, setIsOpen] = useState(!initiallyFolded)

  const Icon = type ? calloutIcons[type] : null

  const handleToggle = (e: React.MouseEvent) => {
    if (!isFoldable) return

    // Don't toggle if clicking inside content
    const target = e.target as HTMLElement
    if (target.closest('.callout-content')) return

    setIsOpen(!isOpen)
  }

  // Build className without the folded state (we control it via React state)
  const baseClassName = className?.replace(/\s*callout-folded\s*/g, ' ').trim()

  return (
    <blockquote
      className={`${baseClassName} ${!isOpen && isFoldable ? 'callout-folded' : ''}`}
      onClick={handleToggle}
      style={{ cursor: isFoldable ? 'pointer' : undefined }}
      data-section-id={sectionId}
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
                  {Icon && <Icon className="w-5 h-5 flex-shrink-0" />}
                  <span className="flex-1">{childProps.children}</span>
                  {isFoldable && (
                    <ChevronRight
                      className={`w-5 h-5 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`}
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
