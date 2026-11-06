import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SectionAnchoredStrokes } from '@/components/annotations/section-anchored-strokes'
import type { AnimatedStroke } from '@/hooks/use-stroke-animation'

const stroke = (id: string, tool?: 'highlighter'): AnimatedStroke => ({
  id,
  points: [{ x: 10, y: 10, pressure: 0.5 }, { x: 60, y: 12, pressure: 0.6 }, { x: 120, y: 11, pressure: 0.4 }],
  mode: 'draw',
  color: '#f00',
  width: tool ? 10 : 2,
  sectionId: 'sec-a',
  sectionOffsetY: 0,
  ...(tool ? { tool } : {}),
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('SectionAnchoredStrokes — highlighter layer', () => {
  it('renders highlighter strokes in their own SVG before (below) the pen SVG', () => {
    const section = document.createElement('div')
    section.setAttribute('data-section-id', 'sec-a')
    document.body.appendChild(section)

    // Pen drawn FIRST, highlighter second — the highlighter must still end up below.
    render(
      <SectionAnchoredStrokes
        strokes={[stroke('pen-1'), stroke('hl-1', 'highlighter')]}
        paperWidth={800}
        paperHeight={600}
        paperPaddingLeft={0}
      />,
    )

    const svgs = Array.from(section.querySelectorAll('svg.annotation-section-svg'))
    expect(svgs).toHaveLength(2)
    const [first, second] = svgs
    expect(first.classList.contains('annotation-highlighter')).toBe(true)
    expect(second.classList.contains('annotation-highlighter')).toBe(false)
    // Each stroke is exactly one path, in its own layer.
    expect(first.querySelectorAll('path')).toHaveLength(1)
    expect(second.querySelectorAll('path')).toHaveLength(1)
  })

  it('renders no highlighter SVG when there are only pen strokes', () => {
    const section = document.createElement('div')
    section.setAttribute('data-section-id', 'sec-a')
    document.body.appendChild(section)

    render(
      <SectionAnchoredStrokes strokes={[stroke('pen-1')]} paperWidth={800} paperHeight={600} paperPaddingLeft={0} />,
    )
    expect(section.querySelectorAll('svg.annotation-highlighter')).toHaveLength(0)
    expect(section.querySelectorAll('svg.annotation-section-svg')).toHaveLength(1)
  })
})
