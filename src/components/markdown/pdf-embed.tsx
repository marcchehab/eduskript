'use client'

import { resolveUrl } from '@/lib/skript-files'
import type { SkriptFilesData } from '@/lib/skript-files'

interface PdfEmbedProps {
  src: string
  height?: string
  files: SkriptFilesData
}

// #paper content width = 1280px − 2×192px padding = 896px
// A4 ratio = 1:√2 ≈ 1:1.4142 → default height = 896 × 1.4142 ≈ 1267px
const DEFAULT_HEIGHT = '1267'

/**
 * Renders an uploaded PDF as an iframe using the browser's native PDF viewer.
 * The src is a filename that gets resolved to a URL via SkriptFiles.
 * Default height matches an A4 portrait page at the #paper content width.
 */
export function PdfEmbed({ src, height = DEFAULT_HEIGHT, files }: PdfEmbedProps) {
  // Resolve filename to URL, fall back to src if already a URL
  const resolvedUrl = resolveUrl(files, src) || src

  return (
    <iframe
      src={resolvedUrl}
      width="100%"
      height={height}
      style={{ border: 'none', borderRadius: '0.5rem' }}
      title={src}
    />
  )
}
