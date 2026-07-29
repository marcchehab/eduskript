/**
 * Public entry point: fence source → two SVG data URLs (light + dark).
 *
 * Pure and isomorphic — the same code runs during SSR/ISR and in the dashboard
 * live preview, so a plot never flashes in late and never needs the network.
 */
import { parsePlotSpec } from './spec'
import { renderPlotSvg, svgToDataUrl } from './svg'
import type { PlotSpecError } from './types'

export interface RenderedPlot {
  light: string
  dark: string
  width: number
  height: number
  /** Text for the img alt attribute, built from the plotted terms. */
  alt: string
  caption?: string
}

export type PlotResult = { plot: RenderedPlot } | { error: PlotSpecError }

/**
 * Memo so the editor preview doesn't re-sample every curve on each keystroke
 * for the plots the author isn't touching. Bounded — this map lives for the
 * lifetime of the server process.
 */
const CACHE_LIMIT = 100
const cache = new Map<string, PlotResult>()

export function renderPlot(source: string): PlotResult {
  const key = source
  const hit = cache.get(key)
  if (hit) return hit

  const result = compute(source)

  if (cache.size >= CACHE_LIMIT) {
    // Cheapest eviction that keeps the map bounded: drop the oldest insertion.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, result)
  return result
}

function compute(source: string): PlotResult {
  const parsed = parsePlotSpec(source)
  if ('error' in parsed) return parsed

  const { spec } = parsed
  try {
    return {
      plot: {
        light: svgToDataUrl(renderPlotSvg(spec, 'light')),
        dark: svgToDataUrl(renderPlotSvg(spec, 'dark')),
        width: spec.width,
        height: spec.height,
        alt: buildAlt(spec.curves.map((c) => `${c.name}(x) = ${c.term}`)),
        caption: spec.caption,
      },
    }
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Could not draw this plot',
        line: 1,
        text: source.split('\n')[0] ?? '',
      },
    }
  }
}

function buildAlt(terms: string[]): string {
  if (terms.length === 0) return 'Empty coordinate system'
  return `Plot of ${terms.join(', ')}`
}

export { parsePlotSpec } from './spec'
export { renderPlotSvg, svgToDataUrl } from './svg'
export type { PlotSpec, PlotSpecError } from './types'
