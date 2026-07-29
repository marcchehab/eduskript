import { renderPlot } from '@/lib/plot'

interface FunctionPlotProps {
  /** Fence body, as written by the author. */
  spec: string
}

/**
 * Renders a ```plot fence as a static SVG image.
 *
 * Deliberately a plain (server-capable) component: the SVG is computed during
 * render, so it lands in the SSR/ISR HTML with no client work and no flash.
 *
 * Two images — light and dark — toggled by CSS, exactly like ExcalidrawImage. A
 * data-URL SVG cannot read the page CSS, and `prefers-color-scheme` inside it
 * would resolve against the OS rather than the app's class-based theme.
 *
 * The image also has to be an <img>: <ai-feedback> composites the section's
 * <img> elements into the picture it sends to the vision model (inline SVG and
 * canvases are invisible to it), which is what makes "draw the tangent on this
 * graph" tasks work.
 */
export function FunctionPlot({ spec }: FunctionPlotProps) {
  const result = renderPlot(spec)

  if ('error' in result) {
    const { message, line, text } = result.error
    return (
      <span className="my-4 block rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <span className="block font-medium text-destructive">Plot error on line {line}: {message}</span>
        {text && <span className="mt-1 block overflow-x-auto font-mono text-xs text-muted-foreground">{text}</span>}
      </span>
    )
  }

  const { light, dark, width, height, alt, caption } = result.plot

  return (
    <span className="my-4 block">
      {/* eslint-disable-next-line @next/next/no-img-element -- data-URL SVG, nothing for the image optimizer to do */}
      <img
        src={light}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
        className="mx-auto block h-auto w-full max-w-full dark:hidden"
        style={{ maxWidth: `${width}px` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dark}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
        className="mx-auto hidden h-auto w-full max-w-full dark:block"
        style={{ maxWidth: `${width}px` }}
      />
      {caption && (
        <span className="mt-2 block text-center text-sm italic text-muted-foreground">{caption}</span>
      )}
    </span>
  )
}
