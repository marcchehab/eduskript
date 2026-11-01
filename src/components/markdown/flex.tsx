'use client'

import { cn } from '@/lib/utils'
import { CSSProperties, ReactNode } from 'react'

// `data-*` props let the rehypeHeadingSectionIds plugin's section attributes
// (data-section-id, data-dynamic-height) survive the component substitution —
// without these, the Flex component would strip the attributes and the per-
// section annotation portal couldn't anchor strokes to the flex container.
interface FlexProps {
  children: ReactNode
  gap?: 'none' | 'small' | 'medium' | 'large'
  className?: string
  style?: CSSProperties
  wrap?: boolean | string
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  'data-section-id'?: string
  'data-dynamic-height'?: string
}

interface FlexItemProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  width?: string
  grow?: boolean | string
  // Editor preview cursor-sync + section attrs survive component substitution.
  'data-source-line-start'?: string
  'data-source-line-end'?: string
  'data-section-id'?: string
  'data-dynamic-height'?: string
}

/**
 * A percentage width is the item's share of the row with the gaps taken out:
 * each item gives up (1 - W) of one gap, so shares summing to 100% fill a row
 * exactly at any container width and any item count (33/33/34), and 50% x 4
 * still wraps into 2 x 2. Other units (px, rem) pass through unchanged.
 */
function itemWidth(width: string): string {
  const percent = width.trim().match(/^(\d+(?:\.\d+)?)%$/)?.[1]
  if (percent === undefined) return width
  return `calc(${percent}% - var(--flex-gap, 0px) * ${1 - Number(percent) / 100})`
}

/**
 * Flex.Item - Child component for flex layouts.
 * When `grow` and no `width` is set, applies `basis-0` so items divide remaining
 * space equally regardless of content length (otherwise flex-grow sizes from
 * intrinsic content width first and you get lopsided columns).
 */
export function FlexItem({ children, className, style, width, grow = true, ...dataAttrs }: FlexItemProps) {
  // Markdown passes attributes as raw strings (e.g. grow="false"), which is
  // truthy in JS — coerce before using as a boolean.
  const doesGrow = typeof grow === 'string' ? grow !== 'false' : grow
  return (
    <div
      className={cn(
        'min-w-0 [&>*:first-child]:mt-0!',
        doesGrow ? 'grow' : 'grow-0',
        doesGrow && !width && 'basis-0',
        // `width` only takes effect at md+, matching Flex's own flex-col->md:flex-row
        // breakpoint — applying it unconditionally (as a plain inline style) clamped
        // items to e.g. 32% even while stacked full-width below md.
        width && 'w-full md:w-(--flex-item-width)',
        className
      )}
      style={{ ...(width ? { '--flex-item-width': itemWidth(width) } as CSSProperties : {}), ...style }}
      {...dataAttrs}
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
  style,
  wrap = true,
  direction = 'row',
  justify = 'start',
  align = 'start',
  ...dataAttrs
}: FlexProps) {
  const gapMap = {
    none: 'gap-0',
    small: 'gap-2',
    medium: 'gap-4',
    large: 'gap-8'
  }

  // Same values as gapMap; FlexItem needs the length for its width calc.
  const gapLength = { none: '0px', small: '0.5rem', medium: '1rem', large: '2rem' }

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

  const doesWrap = typeof wrap === 'string' ? wrap !== 'false' : wrap

  return (
    <div
      className={cn(
        'flex',
        direction === 'row' ? 'flex-row' : 'flex-col',
        doesWrap ? 'flex-wrap' : 'flex-nowrap',
        gapMap[gap],
        justifyMap[justify],
        alignMap[align],
        // Stack on mobile, side-by-side on md+
        'flex-col md:flex-row',
        className
      )}
      style={{ '--flex-gap': gapLength[gap], ...style } as CSSProperties}
      {...dataAttrs}
    >
      {children}
    </div>
  )
}
