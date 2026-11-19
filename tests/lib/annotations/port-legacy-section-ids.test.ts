import { describe, it, expect } from 'vitest'
import {
  classifySectionId,
  legacySectionIdMap,
  portUserData,
  portUserDataForContent,
} from '@/lib/annotations/port-legacy-section-ids'

const CONTENT = [
  '# Title',
  '',
  '> [!tip] Tip',
  '> Body.',
  '',
  '## 1 Basics',
  '',
  '<plugin src="t/lab" />',
  '',
  '<plugin src="t/lab" />',
  '',
  '## 2 Addieren',
  '',
  '> [!abstract]- Aufgabe',
  '> Folded.',
].join('\n')

const stroke = (id: string, sectionId: string | undefined, y = 10) => ({
  id, points: [{ x: 1, y, pressure: 0.5 }], mode: 'draw', color: '#000', width: 2, sectionId, sectionOffsetY: 123.456789, avgY: y,
})

describe('legacySectionIdMap', () => {
  it('maps the legacy ids of the real compile to current ids', async () => {
    const map = await legacySectionIdMap(CONTENT)
    expect(map.get('callout-0')).toBe('callout@h1-@title#1')
    expect(map.get('callout-0-end')).toBe('callout@h1-@title#1-end')
    expect(map.get('h2-1-basics')).toBe('h2-@basics')
    expect(map.get('plugin-t-lab')).toBe('plugin-t-lab@h2-@basics#1')
    expect(map.get('plugin-t-lab-2')).toBe('plugin-t-lab@h2-@basics#2')
    expect(map.get('callout-1')).toBe('callout@h2-@addieren#1')
  })

  it('compiles <next-stage> stages separately, first stage wins on duplicate legacy ids', async () => {
    const staged = '> [!tip] A\n> a\n\n<next-stage />\n\n## Later\n\n> [!tip] B\n> b\n'
    const map = await legacySectionIdMap(staged)
    expect(map.get('callout-0')).toBe('callout@top#1')
    expect(map.get('h2-later')).toBe('h2-@later')
  })
})

describe('portUserData', () => {
  it('rewrites legacy ids only, leaves every other field, current ids, orphans and specials alone', async () => {
    const strokes = [
      stroke('a', 'callout-0'),
      stroke('b', 'h2-1-basics'),
      stroke('c', 'plugin-t-lab-2-end'),
      stroke('d', 'h2-@basics'),
      stroke('e', 'callout-9'), // orphan
      stroke('f', 'unknown'),
      stroke('g', 'paper-top'),
      stroke('h', 'spacer-xyz'),
      stroke('i', undefined),
    ]
    const data = { canvasData: JSON.stringify(strokes), headingOffsets: { 'h2-1-basics': 5 }, pageVersion: 'v1', paddingLeft: 3 }
    const res = await portUserDataForContent('annotations', data, CONTENT)

    expect(res.changed).toBe(true)
    expect(res.counts).toEqual({ rewritten: 3, current: 2, orphan: 1, spacer: 1, unanchored: 2 })
    expect(res.orphanIds).toEqual(['callout-9'])
    const out = res.data as typeof data
    expect(out.headingOffsets).toEqual(data.headingOffsets)
    expect(out.pageVersion).toBe('v1')
    expect(out.paddingLeft).toBe(3)
    const parsed = JSON.parse(out.canvasData) as ReturnType<typeof stroke>[]
    expect(parsed.map(s => s.sectionId)).toEqual([
      'callout@h1-@title#1', 'h2-@basics', 'plugin-t-lab@h2-@basics#2-end',
      'h2-@basics', 'callout-9', 'unknown', 'paper-top', 'spacer-xyz', undefined,
    ])
    // Nothing but sectionId changed.
    parsed.forEach((s, i) => expect({ ...s, sectionId: null }).toEqual({ ...strokes[i], sectionId: null }))
  })

  it('is idempotent', async () => {
    const map = await legacySectionIdMap(CONTENT)
    const data = { canvasData: JSON.stringify([stroke('a', 'callout-1-end'), stroke('b', 'callout-7')]) }
    const once = portUserData('annotations', data, map)
    expect(once.changed).toBe(true)
    const twice = portUserData('annotations', once.data, map)
    expect(twice.changed).toBe(false)
    expect(twice.data).toBe(once.data)
    expect(twice.counts).toMatchObject({ rewritten: 0, current: 1, orphan: 1 })
  })

  it('returns the input object when nothing is legacy (orphans only)', async () => {
    const map = await legacySectionIdMap(CONTENT)
    const data = { canvasData: JSON.stringify([stroke('a', 'h2-gone')]) }
    const res = portUserData('annotations', data, map)
    expect(res.changed).toBe(false)
    expect(res.data).toBe(data)
    expect(res.counts.orphan).toBe(1)
  })

  it('ports snaps and sticky notes', async () => {
    const map = await legacySectionIdMap(CONTENT)
    const snaps = portUserData('snaps', { snaps: [{ id: 's', top: 1, sectionId: 'callout-1', sectionOffsetY: 9 }] }, map)
    expect((snaps.data as { snaps: Array<{ sectionId: string; sectionOffsetY: number }> }).snaps[0]).toEqual({ id: 's', top: 1, sectionId: 'callout@h2-@addieren#1', sectionOffsetY: 9 })
    const notes = portUserData('sticky-notes', { notes: [{ id: 'n', sectionId: 'h2-2-addieren' }], deletedIds: ['x'] }, map)
    expect(notes.data).toEqual({ notes: [{ id: 'n', sectionId: 'h2-@addieren' }], deletedIds: ['x'] })
  })

  it('leaves empty, malformed and unrelated payloads unchanged', async () => {
    const map = await legacySectionIdMap(CONTENT)
    expect(portUserData('annotations', { canvasData: '' }, map).changed).toBe(false)
    const bad = portUserData('annotations', { canvasData: '{nope' }, map)
    expect(bad.changed).toBe(false)
    expect(bad.error).toBeDefined()
    expect(portUserData('spacers', { spacers: [{ afterBlockIndex: 2 }] }, map).changed).toBe(false)
    expect(portUserData('snaps', null, map).changed).toBe(false)
  })
})

describe('classifySectionId', () => {
  it('never rewrites an id that maps to itself', () => {
    expect(classifySectionId('x', new Map([['x', 'x']]))).toEqual({ status: 'current' })
  })
})
