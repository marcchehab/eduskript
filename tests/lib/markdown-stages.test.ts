import { describe, it, expect } from 'vitest'
import { splitStages, hasStages } from '@/lib/markdown-stages'

describe('splitStages', () => {
  it('returns one stage and no markers when there is no marker', () => {
    const r = splitStages('# Title\n\nsome text')
    expect(r.stages).toHaveLength(1)
    expect(r.markers).toHaveLength(0)
    expect(r.stages[0]).toContain('some text')
  })

  it('splits on the marker and captures label', () => {
    const r = splitStages('stage zero\n<next-stage label="Continue">\nstage one')
    expect(r.stages).toEqual(['stage zero', 'stage one'])
    expect(r.markers[0].label).toBe('Continue')
  })

  it('captures all overridable strings (label/title/confirm/cancel) for localization', () => {
    const r = splitStages(
      'a\n<next-stage label="Weiter" title="Weitermachen?" confirm="Kein Zurück." cancel="Hier bleiben">\nb',
    )
    expect(r.markers[0]).toEqual({
      label: 'Weiter',
      title: 'Weitermachen?',
      confirm: 'Kein Zurück.',
      cancel: 'Hier bleiben',
    })
  })

  it('handles multiple markers', () => {
    const r = splitStages('a\n<next-stage>\nb\n<next-stage label="X" confirm="sure?">\nc')
    expect(r.stages).toEqual(['a', 'b', 'c'])
    expect(r.markers).toHaveLength(2)
    expect(r.markers[1].confirm).toBe('sure?')
    // markers describe the boundaries between stages
    expect(r.markers.length).toBe(r.stages.length - 1)
  })

  it('ignores a <next-stage> inside a fenced code block', () => {
    const md = 'before\n\n```html\n<next-stage>\n```\n\nafter'
    const r = splitStages(md)
    expect(r.stages).toHaveLength(1)
    expect(r.markers).toHaveLength(0)
    expect(r.stages[0]).toContain('<next-stage>')
  })

  it('hasStages detects the marker', () => {
    expect(hasStages('x\n<next-stage>\ny')).toBe(true)
    expect(hasStages('no marker here')).toBe(false)
  })
})
