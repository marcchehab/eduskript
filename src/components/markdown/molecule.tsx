'use client'

import { useCallback } from 'react'
import { ResizableWrapper } from './resizable-wrapper'

/**
 * `<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />`
 *
 * Renders a structural formula as an `<img>` pointing at
 * /api/render/molecule.svg. The drawing library stays on the server (1.1 MB),
 * the page carries a short URL instead of an inline SVG, and the browser caches
 * each molecule — the same `O` on twenty pages is fetched once.
 *
 * An `<img>` (rather than an iframe plugin) is also what makes the drawing
 * usable in tasks: `<ai-feedback>` composites the section's images into what it
 * sends to the vision model, and the pens draw on top of it.
 *
 * In the editor preview the drawing gets the same resize/align gizmos as an
 * image, via the shared ResizableWrapper — dragging writes the tag back to the
 * markdown, exactly like `<img>` does.
 */

interface MoleculeProps {
  smiles: string
  /** Caption under the drawing — usually the trivial name. */
  name?: string
  /** Rendered size of the SVG in px (the drawing's own resolution). */
  width?: number
  height?: number
  /** Display width as a percentage of the column, set by the resize gizmo. */
  displayWidth?: number
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  /** Editor only: rewrite this molecule's tag in the markdown source. */
  onLayoutChange?: (smiles: string, newMarkdown: string) => void
}

const DEFAULT_WIDTH = 420
const DEFAULT_HEIGHT = 300

function url(smiles: string, width: number, height: number, theme: 'light' | 'dark'): string {
  const params = new URLSearchParams({
    smiles,
    w: String(width),
    h: String(height),
    theme,
  })
  return `/api/render/molecule.svg?${params.toString()}`
}

export function MoleculeDiagram({
  smiles,
  name,
  width,
  height,
  displayWidth,
  align = 'center',
  wrap = false,
  onLayoutChange,
}: MoleculeProps) {
  const w = Number.isFinite(width) && width ? width : DEFAULT_WIDTH
  const h = Number.isFinite(height) && height ? height : DEFAULT_HEIGHT

  // Serialize the tag back after a gizmo drag. Same shape the author typed, so
  // the markdown stays hand-editable.
  const handleLayoutChange = useCallback(
    (layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => {
      if (!onLayoutChange) return
      let attrs = `smiles="${smiles}"`
      if (name) attrs += ` name="${name.replace(/"/g, '&quot;')}"`
      if (width) attrs += ` width="${width}"`
      if (height) attrs += ` height="${height}"`
      if (Math.round(layout.width) !== 100) attrs += ` display-width="${Math.round(layout.width)}"`
      if (layout.align !== 'center') attrs += ` align="${layout.align}"`
      if (layout.wrap) attrs += ' wrap="true"'
      onLayoutChange(smiles, `<molecule ${attrs} />`)
    },
    [onLayoutChange, smiles, name, width, height]
  )

  if (!smiles.trim()) {
    return (
      <span className="my-4 block rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        &lt;molecule&gt; needs a smiles attribute, for example smiles=&quot;CCO&quot;
      </span>
    )
  }

  const alt = name ? `Strukturformel von ${name}` : `Strukturformel (SMILES ${smiles})`

  return (
    <ResizableWrapper
      initialWidth={displayWidth}
      align={align}
      wrap={wrap}
      onLayoutChange={onLayoutChange ? handleLayoutChange : undefined}
      naturalMaxWidth={w}
    >
      <span className="my-4 block">
        {/* Theme switch via .molecule-light / .molecule-dark in globals.css, for
            the same reason the plot uses classes: prose image rules outrank the
            `dark:hidden` utilities and would show both variants stacked. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG from our own route; nothing for the optimizer to do */}
        <img
          src={url(smiles, w, h, 'light')}
          alt={alt}
          width={w}
          height={h}
          loading="lazy"
          decoding="async"
          className="molecule-light mx-auto h-auto w-full max-w-full"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url(smiles, w, h, 'dark')}
          alt={alt}
          width={w}
          height={h}
          loading="lazy"
          decoding="async"
          className="molecule-dark mx-auto h-auto w-full max-w-full"
        />
        {name && (
          <span className="mt-2 block text-center text-sm italic text-muted-foreground">{name}</span>
        )}
      </span>
    </ResizableWrapper>
  )
}
