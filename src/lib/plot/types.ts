/** Shared shapes for the plot pipeline (spec → sample → svg). */

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface PlotCurve {
  /** Display name (`f`, `g`, … or whatever the author wrote). */
  name: string
  /** The source term, kept for the legend and the img alt text. */
  term: string
  fn: (x: number) => number
  color?: string
  label?: string
  style: LineStyle
  thick: boolean
}

export interface PlotPoint {
  name: string
  x: number
  y: number
  label?: string
  color?: string
}

export interface PlotGuide {
  axis: 'x' | 'y'
  value: number
  color?: string
  style: LineStyle
  label?: string
}

export interface PlotSpec {
  curves: PlotCurve[]
  points: PlotPoint[]
  guides: PlotGuide[]
  xRange: [number, number]
  /** Omitted → derived from the samples (see sample.ts autoYRange). */
  yRange?: [number, number]
  grid: boolean
  axes: boolean
  legend: boolean | undefined
  /** One x-unit renders as long as one y-unit. */
  equalAspect: boolean
  width: number
  height: number
  caption?: string
}

export interface PlotSpecError {
  message: string
  /** 1-based line inside the fence body. */
  line: number
  /** The offending source line, for the error box. */
  text: string
}
