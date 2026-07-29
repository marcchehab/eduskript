/**
 * Plot palettes. A data-URL SVG can't read the page CSS, so the values from
 * globals.css (`--es-color-*`, `--card`, `--border`, `--muted-foreground`) are
 * duplicated here as literals — light values are Tailwind 700, dark ones 300,
 * the same convention as the text palette in lib/color-palette.ts.
 *
 * The light palette must stay dark-on-white: `<ai-feedback>` composites the
 * visible image onto a white canvas (lib/annotations/render-strokes-to-png.ts),
 * where pale lines would vanish.
 */

export type PlotTheme = 'light' | 'dark'

export interface PlotPalette {
  background: string
  axis: string
  grid: string
  text: string
  guide: string
  /** Cycled through in order for curves without an explicit colour. */
  series: string[]
  named: Record<string, string>
}

const LIGHT_NAMED: Record<string, string> = {
  blue: '#1d4ed8',
  red: '#b91c1c',
  green: '#15803d',
  orange: '#c2410c',
  purple: '#9333ea',
  violet: '#6d28d9',
  cyan: '#0e7490',
  teal: '#0e7490',
  lightblue: '#0369a1',
  pink: '#be185d',
  brown: '#92400e',
  gray: '#525252',
  grey: '#525252',
  black: '#262626',
}

const DARK_NAMED: Record<string, string> = {
  blue: '#93c5fd',
  red: '#fca5a5',
  green: '#86efac',
  orange: '#fdba74',
  purple: '#d8b4fe',
  violet: '#c4b5fd',
  cyan: '#67e8f9',
  teal: '#67e8f9',
  lightblue: '#bae6fd',
  pink: '#f9a8d4',
  brown: '#d6a97a',
  gray: '#a3a3a3',
  grey: '#a3a3a3',
  black: '#e6e6e6',
}

const SERIES_ORDER = ['blue', 'red', 'green', 'orange', 'purple', 'cyan', 'brown', 'pink']

export const PALETTES: Record<PlotTheme, PlotPalette> = {
  light: {
    background: '#ffffff',
    axis: '#262626',
    grid: '#e0e0e0',
    text: '#595959',
    guide: '#9ca3af',
    series: SERIES_ORDER.map((name) => LIGHT_NAMED[name]),
    named: LIGHT_NAMED,
  },
  dark: {
    background: '#131313',
    axis: '#e6e6e6',
    grid: '#333333',
    text: '#999999',
    guide: '#6b7280',
    series: SERIES_ORDER.map((name) => DARK_NAMED[name]),
    named: DARK_NAMED,
  },
}

/** Resolve an author colour token: a palette name, or a hex value used as-is. */
export function resolveColor(
  token: string | undefined,
  palette: PlotPalette,
  fallbackIndex: number
): string {
  if (token) {
    if (token.startsWith('#')) return token
    const named = palette.named[token]
    if (named) return named
  }
  return palette.series[fallbackIndex % palette.series.length]
}
