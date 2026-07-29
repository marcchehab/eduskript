/**
 * PlotSpec → SVG string.
 *
 * d3-scale supplies the scales and the "nice numbers" tick selection, d3-shape
 * the path data (`line().defined()` is exactly the pole-gap behaviour we need).
 * The markup is written by hand and stays flat — it ends up inside a data URL,
 * so every byte is duplicated per theme and again in the RSC payload.
 */
import { scaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { autoYRange, sampleCurve, simplify, type Sample } from './sample'
import { PALETTES, resolveColor, type PlotPalette, type PlotTheme } from './theme'
import { typesetTspans } from './typeset'
import type { PlotSpec } from './types'

const MARGIN = { top: 12, right: 14, bottom: 28, left: 46 }
const FONT = 'system-ui,-apple-system,&quot;Segoe UI&quot;,Roboto,sans-serif'
/** Clamp pixel coordinates so the path data never carries 1e17. */
const OVERFLOW_FACTOR = 3

const DASH: Record<string, string> = {
  solid: '',
  dashed: ' stroke-dasharray="6 4"',
  dotted: ' stroke-dasharray="1.5 3.5"',
}

export function renderPlotSvg(spec: PlotSpec, theme: PlotTheme): string {
  const palette = PALETTES[theme]
  const plotWidth = spec.width - MARGIN.left - MARGIN.right
  const plotHeight = spec.height - MARGIN.top - MARGIN.bottom

  const x = scaleLinear().domain(spec.xRange).range([0, plotWidth])

  // The y-window may depend on the samples, and the samples need a y-scale for
  // the pole test — so when the author left `y:` out, probe once with the pole
  // test disabled (Infinity threshold), derive the window, then sample for real.
  const provisional = scaleLinear().domain([-1, 1]).range([plotHeight, 0])
  let yDomain =
    spec.yRange ??
    autoYRange(
      spec.curves.flatMap((curve) =>
        sampleCurve(curve.fn, spec.xRange[0], spec.xRange[1], plotWidth, provisional, Infinity)
      )
    )
  if (spec.equalAspect) yDomain = matchAspect(spec.xRange, yDomain, plotWidth, plotHeight)

  const y = scaleLinear().domain(yDomain).range([plotHeight, 0])

  const xTicks = x.ticks(tickCount(plotWidth))
  const yTicks = y.ticks(tickCount(plotHeight))
  const format = tickFormatter([...xTicks, ...yTicks])

  const parts: string[] = []
  parts.push(`<rect width="${spec.width}" height="${spec.height}" fill="${palette.background}"/>`)
  parts.push(`<g transform="translate(${MARGIN.left},${MARGIN.top})">`)

  if (spec.grid) {
    const lines = [
      ...xTicks.map((t) => `M${round(x(t))} 0V${round(plotHeight)}`),
      ...yTicks.map((t) => `M0 ${round(y(t))}H${round(plotWidth)}`),
    ]
    parts.push(`<path d="${lines.join('')}" stroke="${palette.grid}" stroke-width="1" fill="none"/>`)
  }

  if (spec.axes) {
    parts.push(renderAxes(x, y, plotWidth, plotHeight, palette))
    parts.push(renderTickLabels(x, y, xTicks, yTicks, plotWidth, plotHeight, palette, format))
  }

  for (const guide of spec.guides) {
    // Guides default to the muted guide colour, not to the series palette.
    const color = guide.color ? resolveColor(guide.color, palette, 0) : palette.guide
    const d = guide.axis === 'x'
      ? `M${round(x(guide.value))} 0V${round(plotHeight)}`
      : `M0 ${round(y(guide.value))}H${round(plotWidth)}`
    parts.push(
      `<path d="${d}" stroke="${color}" stroke-width="1.5" fill="none"${DASH[guide.style] || DASH.dashed}/>`
    )
  }

  // Curves are clipped: ids inside a data-URL SVG are document-local, so a
  // fixed id can't collide with the page or another plot.
  parts.push(`<clipPath id="c"><rect width="${plotWidth}" height="${plotHeight}"/></clipPath>`)
  parts.push('<g clip-path="url(#c)">')
  spec.curves.forEach((curve, index) => {
    const color = resolveColor(curve.color, palette, index)
    const overflow = plotHeight * OVERFLOW_FACTOR
    const toPixels = (samples: Sample[]): Sample[] =>
      samples.map((p) => ({ x: x(p.x), y: clamp(y(p.y), -overflow, plotHeight + overflow) }))

    const runs = sampleCurve(
      curve.fn,
      spec.xRange[0],
      spec.xRange[1],
      plotWidth,
      y,
      plotHeight,
      yDomain[1] - yDomain[0]
    )
    const path = d3line<Sample>()
      .x((p) => round(p.x))
      .y((p) => round(p.y))
    const d = runs
      .map((run) => path(simplify(toPixels(run))) ?? '')
      .join('')
    if (!d) return
    parts.push(
      `<path d="${d}" stroke="${color}" stroke-width="${curve.thick ? 3 : 2}" fill="none" stroke-linejoin="round" stroke-linecap="round"${DASH[curve.style]}/>`
    )
  })
  parts.push('</g>')

  for (const point of spec.points) {
    const color = resolveColor(point.color, palette, 0)
    const px = round(x(point.x))
    const py = round(y(point.y))
    parts.push(`<circle cx="${px}" cy="${py}" r="4" fill="${color}"/>`)
    if (point.label) {
      parts.push(
        `<text x="${px + 7}" y="${py - 7}" fill="${palette.axis}" font-family="${FONT}" font-size="12">${escapeText(point.label)}</text>`
      )
    }
  }

  // A legend appears for more than one curve, or as soon as the author wrote an
  // explicit label — a lone labelled curve wants that label shown, otherwise the
  // label the author typed goes nowhere.
  const hasLabel = spec.curves.some((c) => c.label)
  if (spec.legend !== false && (spec.legend === true || hasLabel || spec.curves.length > 1)) {
    parts.push(renderLegend(spec, palette))
  }

  parts.push('</g>')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" ` +
    `viewBox="0 0 ${spec.width} ${spec.height}" role="img">${parts.join('')}</svg>`
  )
}

// --- pieces -----------------------------------------------------------------

type Scale = (value: number) => number

/** Axes sit at x=0 / y=0 when that is inside the window, otherwise on the border. */
function renderAxes(x: Scale, y: Scale, width: number, height: number, palette: PlotPalette): string {
  const xAxisY = clamp(y(0), 0, height)
  const yAxisX = clamp(x(0), 0, width)
  const arrows =
    `<path d="M${round(width)} ${round(xAxisY)}l-7 -3.5v7z" fill="${palette.axis}"/>` +
    `<path d="M${round(yAxisX)} 0l-3.5 7h7z" fill="${palette.axis}"/>`
  return (
    `<path d="M0 ${round(xAxisY)}H${round(width)}M${round(yAxisX)} ${round(height)}V0" ` +
    `stroke="${palette.axis}" stroke-width="1.2" fill="none"/>${arrows}`
  )
}

function renderTickLabels(
  x: Scale,
  y: Scale,
  xTicks: number[],
  yTicks: number[],
  width: number,
  height: number,
  palette: PlotPalette,
  format: (value: number) => string
): string {
  const xAxisY = clamp(y(0), 0, height)
  const yAxisX = clamp(x(0), 0, width)
  const out: string[] = [
    `<g font-family="${FONT}" font-size="11" fill="${palette.text}">`,
  ]
  for (const tick of xTicks) {
    if (tick === 0) continue
    out.push(
      `<text x="${round(x(tick))}" y="${round(Math.min(xAxisY + 15, height + 15))}" text-anchor="middle">${format(tick)}</text>`
    )
  }
  for (const tick of yTicks) {
    if (tick === 0) continue
    out.push(
      `<text x="${round(Math.max(yAxisX - 7, -6))}" y="${round(y(tick) + 4)}" text-anchor="end">${format(tick)}</text>`
    )
  }
  out.push('</g>')
  return out.join('')
}

function renderLegend(spec: PlotSpec, palette: PlotPalette): string {
  const size = 12
  const rows = spec.curves.map((curve, index) => {
    const color = resolveColor(curve.color, palette, index)
    // An explicit label is the author's own words and stays verbatim; a term
    // gets typeset (italic variables, raised exponents). Real KaTeX is out of
    // reach — an img-embedded SVG renders neither HTML nor MathML.
    const content = curve.label
      ? escapeText(curve.label)
      : typesetTspans(`${curve.name}(x) = ${curve.term}`, size)
    const dy = index * 17
    return (
      `<path d="M0 ${dy + 8}h14" stroke="${color}" stroke-width="2"${DASH[curve.style]}/>` +
      // xml:space="preserve": without it the renderer trims the spaces that sit
      // at tspan boundaries, and "1/3x³ − x" collapses to "1/3x³−x".
      `<text x="19" y="${dy + 12}" xml:space="preserve" fill="${palette.axis}" font-family="${FONT}" font-size="${size}">${content}</text>`
    )
  })
  return `<g transform="translate(8,6)">${rows.join('')}</g>`
}

// --- helpers ----------------------------------------------------------------

/** Grow the shorter axis so one x-unit covers the same pixels as one y-unit. */
function matchAspect(
  xRange: [number, number],
  yRange: [number, number],
  width: number,
  height: number
): [number, number] {
  const unitsPerPixel = (xRange[1] - xRange[0]) / width
  const wantedSpan = unitsPerPixel * height
  const currentSpan = yRange[1] - yRange[0]
  if (wantedSpan <= currentSpan) return yRange
  const centre = (yRange[0] + yRange[1]) / 2
  return [centre - wantedSpan / 2, centre + wantedSpan / 2]
}

function tickCount(pixels: number): number {
  return clamp(Math.round(pixels / 60), 4, 12)
}

/** One formatter for both axes: enough decimals for the smallest step, no more. */
function tickFormatter(ticks: number[]): (value: number) => string {
  const steps = ticks
    .map((t, i) => Math.abs(t - ticks[i - 1]))
    .filter((d) => Number.isFinite(d) && d > 0)
  const smallest = steps.length ? Math.min(...steps) : 1
  const decimals = clamp(Math.ceil(-Math.log10(smallest)) + 1, 0, 4)
  return (value: number) => {
    if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) {
      return value.toExponential(1).replace('e+', 'e')
    }
    return String(Number(value.toFixed(decimals)))
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * SVG → `src` value. Percent-escape only what has to be escaped: `%` and `#`
 * break the URL, `<>"'&` break the surrounding HTML attribute, and anything
 * outside printable ASCII (umlauts in labels) is not valid in a URL. That is
 * ~30 % smaller than encodeURIComponent over the whole string.
 */
export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml,' + svg.replace(/[^\x20-\x7E]|[%#<>"'&\\]/gu, (char) => encodeURIComponent(char))
}
