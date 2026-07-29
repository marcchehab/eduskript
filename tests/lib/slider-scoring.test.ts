import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import {
  defaultWindow,
  numberRatio,
  parseExpectedNumber,
  parseExpectedRange,
  rangeRatio,
} from '@/lib/slider-scoring'
import { scoreFromRatio } from '@/lib/output-comparison'

// Compiled WITHOUT the component map: the quiz component needs a
// UserDataProvider, and what matters here is what the pipeline hands it —
// the parsed <answer-feedback> child.
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('number slider scoring', () => {
  const check = { expected: -1, tolerance: 0.15, window: 1 }

  it('gives full credit inside the tolerance', () => {
    expect(numberRatio(-1, check)).toBe(1)
    expect(numberRatio(-0.9, check)).toBe(1)
  })

  it('fades linearly outside it and bottoms out at zero', () => {
    expect(numberRatio(-1.65, check)).toBeCloseTo(0.5)
    expect(numberRatio(0.5, check)).toBe(0)
  })

  it('degenerates to right/wrong when the window is zero', () => {
    expect(numberRatio(-1.2, { ...check, window: 0 })).toBe(0)
    expect(numberRatio(-1, { ...check, window: 0 })).toBe(1)
  })

  it('defaults the window to a quarter of the slider span', () => {
    expect(defaultWindow(-2, 2)).toBe(1)
  })

  it('buys partial credit through the same helper text answers use', () => {
    expect(scoreFromRatio(numberRatio(-1.65, check), 2)).toBeCloseTo(1)
  })
})

describe('range slider scoring', () => {
  it('scores by overlap over union', () => {
    expect(rangeRatio({ min: -1, max: 1 }, { min: -1, max: 1 })).toBe(1)
    // Guessing twice as wide as the target costs half the score.
    expect(rangeRatio({ min: -2, max: 2 }, { min: -1, max: 1 })).toBeCloseTo(0.5)
    // …and so does guessing half as wide.
    expect(rangeRatio({ min: -0.5, max: 0.5 }, { min: -1, max: 1 })).toBeCloseTo(0.5)
    expect(rangeRatio({ min: 2, max: 3 }, { min: -1, max: 1 })).toBe(0)
  })
})

describe('expected parsing', () => {
  it('reads a value or an interval', () => {
    expect(parseExpectedNumber(' -1 ')).toBe(-1)
    expect(parseExpectedRange('-1..1')).toEqual({ min: -1, max: 1 })
    expect(parseExpectedRange('1, -1')).toEqual({ min: -1, max: 1 })
    expect(parseExpectedRange('-1')).toBeNull()
  })
})

describe('feedback markdown', () => {
  it('renders math and markdown from the feedback attribute', async () => {
    const out = await html(
      '<question id="q1" type="single" showFeedback="true">\nPick\n' +
        '<answer correct="true">yes</answer>\n' +
        '<answer feedback="**Nope** — $f\'(x) = x^2$">no</answer>\n' +
        '</question>'
    )
    expect(out).toContain('<answer-feedback>')
    expect(out).toContain('<strong>Nope</strong>')
    expect(out).toContain('katex')
    // The dollar signs must be gone, not printed literally.
    expect(out).not.toContain("$f'(x)")
  })

  it('keeps the answer label separate from its feedback', async () => {
    const out = await html(
      '<question id="q2" type="single">\nPick\n<answer feedback="hint">label</answer>\n</question>'
    )
    expect(out).toMatch(/<answer[^>]*><answer-feedback>hint<\/answer-feedback>label<\/answer>/)
  })

  it('carries feedback bands on a slider question', async () => {
    const out = await html(
      '<question id="q3" type="number" minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15" showFeedback="true">\n' +
        'Guess\n' +
        '<answer from="1" feedback="Spot on, $x = -1$"></answer>\n' +
        '<answer feedback="Not yet"></answer>\n' +
        '</question>'
    )
    expect(out).toContain('answer-feedback')
    expect(out).toContain('katex')
  })
})
