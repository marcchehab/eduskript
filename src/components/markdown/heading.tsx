'use client'

import { ReactNode } from 'react'
import type { JSX } from 'react'

interface HeadingProps {
  level: 1 | 2 | 3 | 4 | 5 | 6
  id?: string
  children?: ReactNode
}

export function Heading({ level, id, children }: HeadingProps) {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements

  // Generate ID from children text if not provided
  const headingId = id || generateSlug(childrenToString(children))

  // Generate section ID for annotation system (h1-h2 only)
  const sectionId = level <= 2 ? `${Tag}-${headingId}` : undefined

  const className = {
    1: 'text-4xl font-bold mb-4',
    2: 'text-3xl font-bold mb-3',
    3: 'text-2xl font-semibold mb-2.5',
    4: 'text-xl font-semibold mb-2',
    5: 'text-lg font-semibold mt-3 mb-1.5',
    6: 'text-base font-semibold mt-2 mb-1',
  }[level]

  return (
    <Tag
      id={headingId}
      className={`${className} group heading-link scroll-mt-20`}
      data-section-id={sectionId}
      data-heading-text={childrenToString(children)}
    >
      <a
        href={`#${headingId}`}
        className="no-underline hover:underline text-foreground"
        aria-label={`Link to ${childrenToString(children)}`}
      >
        {children}
      </a>
    </Tag>
  )
}

// Helper to extract text from React children
function childrenToString(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) {
    return children.map(childrenToString).join('')
  }
  return ''
}

// Generate slug from text
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
