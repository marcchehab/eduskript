'use client'

import React from 'react'
import Image from 'next/image'
import { useCallback } from 'react'
import { useTheme } from 'next-themes'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveFile, resolveUrl } from '@/lib/skript-files'
import { ResizableWrapper } from './resizable-wrapper'

/**
 * Parse markdown links [text](url) in a string and return React elements
 */
function parseMarkdownLinks(text: string): React.ReactNode {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    // Add the link
    parts.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline not-italic"
      >
        {match[1]}
      </a>
    )
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

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
  optimizeImages?: boolean // Enable Next.js Image optimization (WebP/AVIF, resizing)
  // Files data for resolving URLs (serializable)
  files?: SkriptFilesData
  // Source line tracking for editor sync
  sourceLineStart?: string
  sourceLineEnd?: string
}

export function ContentImage({ src, alt = '', title, style, onWidthChange, originalSrc, align = 'center', wrap = false, invert, saturate, optimizeImages, files, sourceLineStart, sourceLineEnd }: ContentImageProps) {
  const filename = originalSrc || src
  const { resolvedTheme } = useTheme()

  // Resolve the image URL and dimensions
  const isRelativePath = src && !src.startsWith('http') && !src.startsWith('/')
  const fileInfo = isRelativePath && files ? resolveFile(files, src) : undefined
  const resolvedSrc = fileInfo?.url
  const imageSrc = resolvedSrc ?? src
  const isMissing = isRelativePath && !resolvedSrc

  // Use stored dimensions if available, fall back to defaults
  const imgWidth = fileInfo?.width ?? 800
  const imgHeight = fileInfo?.height ?? 600

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

    // Build <img> element with standard HTML attributes
    // Using style for width, data-* for custom layout attributes
    let attrs = `src="${filename}" alt="${alt}" style="width: ${Math.round(layout.width)}%"`
    if (layout.align !== 'center') {
      attrs += ` data-align="${layout.align}"`
    }
    if (layout.wrap) {
      attrs += ` data-wrap="true"`
    }
    // Preserve invert/saturate if present
    if (invert) {
      attrs += ` data-invert="${invert}"`
    }
    if (saturate) {
      attrs += ` data-saturate="${saturate}"`
    }

    onWidthChange(`<img ${attrs} />`)
  }, [alt, filename, invert, saturate, onWidthChange])

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
            width={imgWidth}
            height={imgHeight}
            className="w-full h-auto rounded-md"
            style={invertFilter ? { filter: invertFilter } : undefined}
            unoptimized={!optimizeImages}
          />
        )}
      </span>

      {/* Caption - supports markdown links [text](url) */}
      {alt && (
        <span className="block mt-2 text-sm text-center text-muted-foreground italic">
          {parseMarkdownLinks(alt)}
        </span>
      )}
    </ResizableWrapper>
  )
}
