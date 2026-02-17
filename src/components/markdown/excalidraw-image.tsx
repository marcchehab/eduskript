'use client'

import { useState, useCallback } from 'react'
import { Pencil } from 'lucide-react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveExcalidraw, resolveFile } from '@/lib/skript-files'
import { ResizableWrapper } from './resizable-wrapper'

interface ExcalidrawImageProps {
  src: string // Filename (e.g., "drawing.excalidraw")
  alt?: string
  style?: React.CSSProperties
  onWidthChange?: (markdown: string) => void
  onEdit?: (filename: string, fileId: string) => void  // Callback to open Excalidraw editor
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  // Files data for resolving URLs (serializable)
  files?: SkriptFilesData
  // Source line tracking for editor sync
  sourceLineStart?: string
  sourceLineEnd?: string
}

export function ExcalidrawImage({ src, alt, style, onWidthChange, onEdit, align = 'center', wrap = false, files, sourceLineStart, sourceLineEnd }: ExcalidrawImageProps) {
  const filename = src
  const caption = alt || ''

  // Resolve light/dark URLs and the original file ID
  const resolved = files ? resolveExcalidraw(files, src) : undefined
  const lightSrc = resolved?.lightUrl ?? ''
  const darkSrc = resolved?.darkUrl ?? ''

  // Get the original .excalidraw file ID for editing
  const excalidrawFile = files ? resolveFile(files, src) : undefined
  const fileId = excalidrawFile?.id ?? ''

  // Get real dimensions from the light SVG file (fall back to 800x600)
  const baseName = src.replace(/\.excalidraw(\.md)?$/, '')
  const lightFile = files?.files[`${baseName}.excalidraw.light.svg`]
  const imgWidth = lightFile?.width ?? 800
  const imgHeight = lightFile?.height ?? 600

  const [lightLoaded, setLightLoaded] = useState(false)
  const [darkLoaded, setDarkLoaded] = useState(false)

  // Parse initial width from style
  const initialWidth = style?.width && typeof style.width === 'string' && style.width.includes('%')
    ? parseFloat(style.width)
    : 100

  // Handle layout changes from the wrapper
  const handleLayoutChange = useCallback((layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => {
    if (!onWidthChange) return

    // Use <excali> component - strip .excalidraw extension (component adds it back)
    const baseName = filename.replace(/\.excalidraw$/, '')
    let props = `src="${baseName}"`
    if (alt) {
      props += ` alt="${alt}"`
    }
    props += ` width="${Math.round(layout.width)}%"`
    if (layout.align !== 'center') {
      props += ` align="${layout.align}"`
    }
    if (layout.wrap) {
      props += ` wrap`
    }

    onWidthChange(`<excali ${props} />`)
  }, [alt, filename, onWidthChange])

  // Early return if file can't be resolved
  if (!lightSrc && !darkSrc) {
    return (
      <span className="block bg-muted rounded-lg p-4 text-center text-muted-foreground my-4">
        <span className="block">Excalidraw file not found: {src}</span>
        <span className="block text-xs mt-1">Make sure the .excalidraw file has light/dark SVG exports</span>
      </span>
    )
  }

  // Build data attributes for source line tracking
  const dataAttributes: Record<string, string> = { excalidraw: filename }
  if (sourceLineStart) dataAttributes['source-line-start'] = sourceLineStart
  if (sourceLineEnd) dataAttributes['source-line-end'] = sourceLineEnd

  return (
    <ResizableWrapper
      initialWidth={initialWidth}
      align={align}
      wrap={wrap}
      onLayoutChange={onWidthChange ? handleLayoutChange : undefined}
      className="excalidraw-wrapper group/excalidraw"
      dataAttributes={dataAttributes}
    >
      {/* Edit button overlay - only shown if onEdit is provided */}
      {onEdit && fileId && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit(filename, fileId)
          }}
          className="absolute top-2 left-2 z-20 p-2 rounded-md bg-background/80 backdrop-blur-sm border border-border shadow-sm opacity-0 group-hover/excalidraw:opacity-100 transition-opacity hover:bg-accent"
          title="Edit drawing"
        >
          <Pencil className="w-4 h-4 text-orange-500" />
        </button>
      )}

      {/* Render both images, CSS controls visibility based on theme */}
      {/* Plain <img> intentional: SVGs don't benefit from Next.js Image optimization */}
      {lightSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={lightSrc}
          alt={caption}
          width={imgWidth}
          height={imgHeight}
          loading="lazy"
          decoding="async"
          onLoad={() => setLightLoaded(true)}
          className={`excalidraw-light w-full h-auto rounded-md transition-opacity duration-200 dark:hidden ${
            lightLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {darkSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={darkSrc}
          alt={caption}
          width={imgWidth}
          height={imgHeight}
          loading="lazy"
          decoding="async"
          onLoad={() => setDarkLoaded(true)}
          className={`excalidraw-dark w-full h-auto rounded-md transition-opacity duration-200 hidden dark:block ${
            darkLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {caption && (
        <span className="block mt-2 text-sm text-center text-muted-foreground italic">
          {caption}
        </span>
      )}
    </ResizableWrapper>
  )
}
