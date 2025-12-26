'use client'

import Image from 'next/image'
import { useCallback } from 'react'
import { useTheme } from 'next-themes'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveUrl } from '@/lib/skript-files'
import { ResizableWrapper } from './resizable-wrapper'

interface ContentImageProps {
  src: string // Filename (e.g., "image.png")
  alt?: string
  title?: string
  style?: React.CSSProperties
  onWidthChange?: (markdown: string) => void
  originalSrc?: string // The original filename from markdown (before URL resolution)
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  invert?: 'dark' | 'light' | 'always' // Invert colors for diagrams
  saturate?: string // Saturation percentage to apply with invert (e.g., '70' or '150')
  // Files data for resolving URLs (serializable)
  files?: SkriptFilesData
  // Source line tracking for editor sync
  sourceLineStart?: string
  sourceLineEnd?: string
}

export function ContentImage({ src, alt = '', title, style, onWidthChange, originalSrc, align = 'center', wrap = false, invert, saturate, files, sourceLineStart, sourceLineEnd }: ContentImageProps) {
  const filename = originalSrc || src
  const { resolvedTheme } = useTheme()

  // Resolve the image URL
  const isRelativePath = src && !src.startsWith('http') && !src.startsWith('/')
  const resolvedSrc = isRelativePath && files ? resolveUrl(files, src) : undefined
  const imageSrc = resolvedSrc ?? src
  const isMissing = isRelativePath && !resolvedSrc

  // Calculate if we should apply invert filter
  const shouldInvert = invert === 'always' ||
    (invert === 'dark' && resolvedTheme === 'dark') ||
    (invert === 'light' && resolvedTheme === 'light')

  // Build the filter string with optional saturate
  const invertFilter = shouldInvert
    ? `invert(1) hue-rotate(180deg)${saturate ? ` saturate(${saturate})` : ''}`
    : undefined

  // Parse initial width from style
  const initialWidth = style?.width && typeof style.width === 'string' && style.width.includes('%')
    ? parseFloat(style.width)
    : 100

  // Handle layout changes from the wrapper
  const handleLayoutChange = useCallback((layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => {
    if (!onWidthChange) return

    // Build <Image> component with props (use filename, not resolved URL)
    let props = `src="${filename}" alt="${alt}" width="${Math.round(layout.width)}%"`
    if (layout.align !== 'center') {
      props += ` align="${layout.align}"`
    }
    if (layout.wrap) {
      props += ` wrap`
    }

    onWidthChange(`<Image ${props} />`)
  }, [alt, filename, onWidthChange])

  // Build data attributes for source line tracking
  const dataAttributes: Record<string, string> = {}
  if (sourceLineStart) dataAttributes['source-line-start'] = sourceLineStart
  if (sourceLineEnd) dataAttributes['source-line-end'] = sourceLineEnd

  return (
    <ResizableWrapper
      initialWidth={initialWidth}
      align={align}
      wrap={wrap}
      onLayoutChange={onWidthChange ? handleLayoutChange : undefined}
      dataAttributes={dataAttributes}
    >
      {/* Image */}
      <span className="block">
        {isMissing ? (
          <span className="flex items-center justify-center w-full h-32 bg-muted border border-dashed border-border rounded-md text-muted-foreground text-sm">
            Missing: {filename}
          </span>
        ) : imageSrc.startsWith('http') ? (
          // External URLs: use native img to avoid Next.js hostname restrictions
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={alt || ''}
            title={title}
            className="w-full h-auto rounded-md"
            style={invertFilter ? { filter: invertFilter } : undefined}
            loading="lazy"
          />
        ) : (
          <Image
            src={imageSrc}
            alt={alt || ''}
            title={title}
            width={800}
            height={600}
            className="w-full h-auto rounded-md"
            style={invertFilter ? { filter: invertFilter } : undefined}
            unoptimized={imageSrc.startsWith('/api/')}
          />
        )}
      </span>

      {/* Caption */}
      {alt && (
        <span className="block mt-2 text-sm text-center text-muted-foreground italic">
          {alt}
        </span>
      )}
    </ResizableWrapper>
  )
}
