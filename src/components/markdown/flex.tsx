'use client'

import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface FlexProps {
  children: ReactNode
  gap?: 'none' | 'small' | 'medium' | 'large'
  className?: string
  wrap?: boolean
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
}

interface FlexItemProps {
  children: ReactNode
  className?: string
  width?: string
  grow?: boolean
}

/**
 * Flex.Item - Child component for flex layouts
 */
export function FlexItem({ children, className, width, grow = true }: FlexItemProps) {
  return (
    <div
      className={cn(
        'min-w-0 [&>*:first-child]:!mt-0',
        grow ? 'flex-grow' : 'flex-grow-0',
        className
      )}
      style={width ? { width } : undefined}
    >
      {children}
    </div>
  )
}

/**
 * Flex - Responsive flex container for side-by-side layouts.
 * Stacks vertically on mobile, horizontally on larger screens.
 */
export function Flex({
  children,
  gap = 'medium',
  className,
  wrap = true,
  direction = 'row',
  justify = 'start',
  align = 'start'
}: FlexProps) {
  const gapMap = {
    none: 'gap-0',
    small: 'gap-2',
    medium: 'gap-4',
    large: 'gap-8'
  }

  const justifyMap = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
    evenly: 'justify-evenly'
  }

  const alignMap = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline'
  }

  return (
    <div
      className={cn(
        'flex',
        direction === 'row' ? 'flex-row' : 'flex-col',
        wrap ? 'flex-wrap' : 'flex-nowrap',
        gapMap[gap],
        justifyMap[justify],
        alignMap[align],
        // Stack on mobile, side-by-side on md+
        'flex-col md:flex-row',
        className
      )}
    >
      {children}
    </div>
  )
}
