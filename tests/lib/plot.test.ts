import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { parsePlotSpec } from '@/lib/plot/spec'
import { renderPlot, svgToDataUrl } from '@/lib/plot'
import { compileExpression } from '@/lib/plot/expression'
import { sampleCurve } from '@/lib/plot/sample'
import { scaleLinear } from 'd3-scale'

// Custom tags only become components when the caller supplies the map, exactly
// like the page renderer does.
async function html(md: string): Promise<string> {
  const components = createMarkdownComponents(createEmptySkriptFiles())
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('plot expressions', () => {
  it('handles implicit multiplication the way teachers write it', () => {
    expect(compileExpression('1/3x^3 - x')(-1)).toBeCloseTo(2 / 3)
    expect(compileExpression('2sin(x)')(Math.PI / 2)).toBeCloseTo(2)
    expect(compileExpression('2(x+1)')(3)).toBe(8)
  })

  it('uses school notation for the logarithms', () => {
    expect(compileExpression('log(100)')(0)).toBeCloseTo(2)
    expect(compileExpression('ln(e)')(0)).toBeCloseTo(1)
  })

  it('lets a later curve use an earlier one', () => {
    const f = compileExpression('x^2')
    expect(compileExpression('f(x) + 2', { f })(3)).toBe(11)
  })

  it('reports unknown names instead of drawing NaN', () => {
    expect(() => compileExpression('lg2(x)')).toThrow()
  })

  it('turns domain errors into gaps, not errors', () => {
    expect(Number.isFinite(compileExpression('ln(x)')(-1))).toBe(false)
  })
})

describe('plot spec', () => {
  it('parses settings, curves, points and guides', () => {
    const result = parsePlotSpec(
      'x: -4..4\ny: -3..3\nnogrid\nf(x) = 1/3x^3 - x\ng(x) = 2sin(x), blue, dashed\nA = (-1, 2/3), label="A"\nvline x=-1 dashed'
    )
    expect('spec' in result).toBe(true)
    if (!('spec' in result)) return
    const { spec } = result
    expect(spec.xRange).toEqual([-4, 4])
    expect(spec.yRange).toEqual([-3, 3])
    expect(spec.grid).toBe(false)
    expect(spec.curves.map((c) => c.name)).toEqual(['f', 'g'])
    expect(spec.curves[1].style).toBe('dashed')
    expect(spec.points[0]).toMatchObject({ name: 'A', x: -1, label: 'A' })
    expect(spec.points[0].y).toBeCloseTo(2 / 3)
    expect(spec.guides[0]).toMatchObject({ axis: 'x', value: -1 })
  })

  it('separates the window from a line: colon vs equals', () => {
    const range = parsePlotSpec('y: -2..8')
    const line = parsePlotSpec('y = 2x + 1')
    expect('spec' in range && range.spec.yRange).toEqual([-2, 8])
    expect('spec' in line && line.spec.curves).toHaveLength(1)
    // `y = 4` has no x, so it is a horizontal guide, not a curve.
    const guide = parsePlotSpec('y = 4')
    expect('spec' in guide && guide.spec.guides[0]).toMatchObject({ axis: 'y', value: 4 })
  })

  it('reports the offending line number', () => {
    const result = parsePlotSpec('x: -4..4\n\nf(x) = sin(')
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.line).toBe(3)
    expect(result.error.text).toBe('f(x) = sin(')
  })
})

describe('plot sampling', () => {
  const y = scaleLinear().domain([-5, 5]).range([360, 0])

  it('breaks the path at poles', () => {
    expect(sampleCurve(Math.tan, -5, 5, 580, y, 360, 10)).toHaveLength(5)
    expect(sampleCurve((x) => 1 / x, -5, 5, 580, y, 360, 10)).toHaveLength(2)
  })

  it('keeps a continuous steep crossing in one piece', () => {
    const narrow = scaleLinear().domain([-1, 1]).range([360, 0])
    expect(sampleCurve((x) => 1000 * x, -5, 5, 580, narrow, 360, 2)).toHaveLength(1)
    expect(sampleCurve(Math.exp, -1, 20, 580, y, 360, 10)).toHaveLength(1)
  })
})

describe('plot rendering', () => {
  it('produces two themed data URLs with no NaN in the path data', () => {
    const result = renderPlot('x: -4..4\nf(x) = x^2')
    expect('plot' in result).toBe(true)
    if (!('plot' in result)) return
    expect(result.plot.light.startsWith('data:image/svg+xml,')).toBe(true)
    expect(result.plot.light).not.toBe(result.plot.dark)
    const svg = decodeURIComponent(result.plot.light.slice('data:image/svg+xml,'.length))
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect(result.plot.alt).toContain('x^2')
  })

  it('escapes the characters that would break a data URL', () => {
    const url = svgToDataUrl('<svg>#100% Höhe & "more"</svg>')
    // Only percent-escapes survive; the raw characters would break the URL or
    // the surrounding HTML attribute.
    expect(url.slice('data:image/svg+xml,'.length)).not.toMatch(/[#<>"'&]/)
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toBe('<svg>#100% Höhe & "more"</svg>')
  })
})

describe('plot in the markdown pipeline', () => {
  it('renders a fence as an <img> so ai-feedback can composite it', async () => {
    const out = await html('```plot\nx: -4..4\nf(x) = x^2\n```')
    expect(out).toContain('<img')
    expect(out).toContain('data:image/svg+xml,')
    expect(out).not.toContain('<code')
  })

  it('works inside a callout, where mermaid still fails', async () => {
    const out = await html('> [!note] Title\n> ```plot\n> f(x) = x\n> ```')
    expect(out).toContain('data:image/svg+xml,')
  })

  it('shows an error box instead of breaking the page', async () => {
    const out = await html('```plot\nf(x) = sin(\n```\n\n## After')
    expect(out).toContain('Plot error on line')
    expect(out).toMatch(/<h2[^>]*>[\s\S]*After[\s\S]*<\/h2>/)
  })
})
