import type { ReactNode } from 'react'
import type { TikzResult } from '@/lib/tikz/render.server'
import { TikzImages } from './tikz-images.client'

/**
 * A rendered ```tikz block: two static SVG images (light and dark), toggled by
 * the same CSS as ```plot (.plot-light / .plot-dark in globals.css).
 *
 * It has to be an <img>: <ai-feedback> composites the section's <img> elements
 * into the picture it sends to the vision model, and an SVG loaded as an image
 * cannot read the page theme, hence the two variants.
 *
 * The sources are files in the teacher bucket (store.server.ts), so a page
 * carries two URLs per diagram.
 */
export function TikzImageView({ result }: { result: TikzResult }) {
  if ('error' in result) return <TikzError message={result.error} />

  const { light, dark, width, height, alt, caption } = result.image
  return (
    <span className="my-4 block">
      <TikzImages light={light} dark={dark} width={width} height={height} alt={alt} />
      {caption && <span className="mt-2 block text-center text-sm italic text-muted-foreground">{caption}</span>}
    </span>
  )
}

/** The TeX error, shown in place of the picture (in the editor preview and on the page). */
export function TikzError({ message }: { message: string }) {
  const [first, ...rest] = message.split('\n')
  return (
    <span className="my-4 block rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="block font-medium text-destructive">TikZ error: {first}</span>
      {rest.length > 0 && (
        <span className="mt-1 block overflow-x-auto whitespace-pre font-mono text-xs text-muted-foreground">{rest.join('\n')}</span>
      )}
    </span>
  )
}

export function TikzPlaceholder({ children }: { children?: ReactNode }) {
  return (
    <span className="tikz-loading my-4 block h-24 rounded-lg bg-muted/40 text-center text-sm leading-[6rem] text-muted-foreground" aria-busy="true">
      {children}
    </span>
  )
}

/**
 * Server path (public pages): TeX runs while the page is rendered, so the
 * picture is in the ISR HTML. `render` is injected by the server renderer; this
 * module itself stays free of Node-only imports because the component map is
 * also bundled for the browser.
 */
export async function TikzServerFigure({ source, render }: { source: string; render: (source: string) => Promise<TikzResult> }) {
  let result: TikzResult
  try {
    result = await render(source)
  } catch (error) {
    result = { error: `TikZ rendering failed: ${(error as Error).message}` }
  }
  return <TikzImageView result={result} />
}
