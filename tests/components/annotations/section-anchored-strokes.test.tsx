import { describe, it, expect, afterEach, vi } from 'vitest'
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

describe('SectionAnchoredStrokes — legacy ids and orphans', () => {
  // DOM as heading-section-ids.ts emits it: current ids on the elements, the
  // legacy → current map on paper-top.
  const page = () => {
    const top = document.createElement('div')
    top.setAttribute('data-section-id', 'paper-top')
    top.setAttribute('data-legacy-section-ids', JSON.stringify({ 'callout-3': 'callout@h2-@x#1', 'callout-3-end': 'callout@h2-@x#1-end' }))
    const callout = document.createElement('blockquote')
    callout.setAttribute('data-section-id', 'callout@h2-@x#1')
    const end = document.createElement('div')
    end.setAttribute('data-section-id', 'callout@h2-@x#1-end')
    document.body.append(top, callout, end)
    return { top, callout, end }
  }
  const at = (id: string, sectionId: string): AnimatedStroke => ({ ...stroke(id), sectionId, sectionOffsetY: 40 })

  it('portals a stroke stored with a legacy id into the element that now carries the mapped id', () => {
    const { callout, end } = page()
    const onOrphansChange = vi.fn()
    render(
      <SectionAnchoredStrokes
        strokes={[at('old', 'callout-3'), at('old-end', 'callout-3-end'), at('new', 'callout@h2-@x#1')]}
        paperWidth={800}
        paperHeight={600}
        paperPaddingLeft={0}
        onOrphansChange={onOrphansChange}
      />,
    )
    expect(callout.querySelectorAll('path')).toHaveLength(2)
    expect(end.querySelectorAll('path')).toHaveLength(1)
    expect(onOrphansChange).toHaveBeenLastCalledWith([])
  })

  it('reports orphans of callout/editor/plugin sections instead of dropping them', () => {
    page()
    const onOrphansChange = vi.fn()
    const gone = [at('a', 'callout-7'), at('b', 'editor-2-end'), at('c', 'plugin-t-lab-3'), at('d', 'callout@h2-@y#1')]
    render(
      <SectionAnchoredStrokes strokes={gone} paperWidth={800} paperHeight={600} paperPaddingLeft={0} onOrphansChange={onOrphansChange} />,
    )
    expect(onOrphansChange).toHaveBeenLastCalledWith(gone)
  })

  it('reference layer (no onOrphansChange) renders orphans itself at their stored coordinates in paper-top', () => {
    const { top } = page()
    render(
      <SectionAnchoredStrokes strokes={[at('a', 'callout-7')]} paperWidth={800} paperHeight={600} paperPaddingLeft={0} />,
    )
    const groups = top.querySelectorAll('svg.annotation-section-svg g')
    expect(groups).toHaveLength(1)
    // jsdom rects are 0: paper-top's offset is 0 → no shift, i.e. absolute y.
    expect(groups[0].getAttribute('transform')).toBe('translate(0, 0)')
    expect(top.querySelectorAll('path')).toHaveLength(1)
  })
})
