'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Maximize2, Sun } from 'lucide-react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveExcalidraw, resolveFile } from '@/lib/skript-files'
import { ResizableWrapper } from './resizable-wrapper'
import { ImageLightbox } from './image-lightbox'

interface ExcalidrawImageProps {
  src: string // Filename (e.g., "drawing.excalidraw")
  alt?: string
  style?: React.CSSProperties
  onWidthChange?: (markdown: string) => void
  onEdit?: (filename: string, fileId: string) => void  // Callback to open Excalidraw editor
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  // Force the light SVG regardless of viewer theme (author override for
  // drawings that don't have a meaningful dark variant, or where the author
  // just prefers the light look). Previously done by hand-renaming the file
  // to drop the dark export; this is the same effect via markdown, not files.
  lightonly?: boolean
  // Files data for resolving URLs (serializable)
  files?: SkriptFilesData
  // Source line tracking for editor sync
  sourceLineStart?: string
  sourceLineEnd?: string
}

export function ExcalidrawImage({ src, alt, style, onWidthChange, onEdit, align = 'center', wrap = false, lightonly = false, files, sourceLineStart, sourceLineEnd }: ExcalidrawImageProps) {
  const filename = src
  const caption = alt || ''
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [forceLight, setForceLight] = useState(lightonly)
  useEffect(() => setForceLight(lightonly), [lightonly])

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

  // Parse initial width from style
  const initialWidth = style?.width && typeof style.width === 'string' && style.width.includes('%')
    ? parseFloat(style.width)
    : 100

  // Rebuilds the <excali> markdown tag from current attributes, with overrides
  // for whichever gizmo just changed. Width/align/wrap fall back to the props
  // (the last-saved values) since only the layout gizmo tracks them live.
  const buildExcaliTag = useCallback((overrides: {
    width?: number
    align?: 'left' | 'center' | 'right'
    wrap?: boolean
    lightonly?: boolean
  }) => {
    const baseName = filename.replace(/\.excalidraw$/, '')
    const nextAlign = overrides.align ?? align
    const nextWrap = overrides.wrap ?? wrap
    const nextLightonly = overrides.lightonly ?? forceLight

    let props = `src="${baseName}"`
    if (alt) {
      props += ` alt="${alt}"`
    }
    props += ` width="${Math.round(overrides.width ?? initialWidth)}%"`
    if (nextAlign !== 'center') {
      props += ` align="${nextAlign}"`
    }
    if (nextWrap) {
      props += ` wrap`
    }
    if (nextLightonly) {
      props += ` lightonly`
    }

    return `<excali ${props} />`
  }, [alt, filename, align, wrap, forceLight, initialWidth])

  // Handle layout changes from the wrapper
  const handleLayoutChange = useCallback((layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => {
    if (!onWidthChange) return
    onWidthChange(buildExcaliTag(layout))
  }, [onWidthChange, buildExcaliTag])

  const handleLightOnlyToggle = useCallback(() => {
    const next = !forceLight
    setForceLight(next)
    onWidthChange?.(buildExcaliTag({ lightonly: next }))
  }, [forceLight, onWidthChange, buildExcaliTag])

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
          className="absolute top-2 left-2 z-20 p-2 rounded-md bg-background/80 backdrop-blur-xs border border-border shadow-xs opacity-0 group-hover/excalidraw:opacity-100 transition-opacity hover:bg-accent"
          title="Edit drawing"
        >
          <Pencil className="w-4 h-4 text-orange-500" />
        </button>
      )}

      {/* Force-light-theme toggle - only shown in editor mode */}
      {onWidthChange && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleLightOnlyToggle()
          }}
          className={`absolute top-2 right-11 z-20 p-1.5 rounded-md border border-border shadow-xs opacity-0 group-hover/excalidraw:opacity-100 transition-opacity hover:bg-accent ${
            forceLight ? 'bg-accent text-accent-foreground' : 'bg-background/80 backdrop-blur-xs'
          }`}
          title={forceLight ? 'Always showing light theme — click to follow viewer theme' : 'Always show light theme, ignore viewer theme'}
        >
          <Sun className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Fullscreen button */}
      <button
        onClick={() => setLightboxOpen(true)}
        className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-background/80 backdrop-blur-xs border border-border shadow-xs opacity-0 group-hover/excalidraw:opacity-100 transition-opacity hover:bg-accent cursor-zoom-in"
        title="Fullscreen"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>

      {/* Render both images, CSS controls visibility based on theme */}
      {/* Plain <img> intentional: SVGs don't benefit from Next.js Image optimization */}
      {/* No loading="lazy" — excalidraw SVGs are typically 10-100 KB and form
          part of the visible content on a page. Lazy loading deferred them
          past the IntersectionObserver tick, which on slow connections made
          drawings appear visibly later than the surrounding text and the
          public-annotation layer. The dark/light variant that's hidden via
          `dark:hidden` / `hidden dark:block` isn't fetched anyway because
          browsers skip downloads for display:none images. */}
      {lightSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={lightSrc}
          alt={caption}
          width={imgWidth}
          height={imgHeight}
          decoding="async"
          className={`excalidraw-light w-full h-auto rounded-md ${forceLight ? '' : 'dark:hidden'}`}
        />
      )}
      {darkSrc && !forceLight && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={darkSrc}
          alt={caption}
          width={imgWidth}
          height={imgHeight}
          decoding="async"
          className="excalidraw-dark w-full h-auto rounded-md hidden dark:block"
        />
      )}
      {caption && (
        <span className="block mt-2 text-sm text-center text-muted-foreground italic">
          {caption}
        </span>
      )}

      {/* Lightbox */}
      <ImageLightbox open={lightboxOpen} onClose={() => setLightboxOpen(false)}>
        {/* Show theme-appropriate image in lightbox */}
        {lightSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lightSrc}
            alt={caption}
            style={{ width: '95vw', height: '90vh' }}
            className={`max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-md ${forceLight ? '' : 'dark:hidden'}`}
          />
        )}
        {darkSrc && !forceLight && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={darkSrc}
            alt={caption}
            style={{ width: '95vw', height: '90vh' }}
            className="max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-md hidden dark:block"
          />
        )}
      </ImageLightbox>
    </ResizableWrapper>
  )
}
