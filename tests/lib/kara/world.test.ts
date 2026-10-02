import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodeEditor from '@/lib/remark-plugins/code-editor'
import {
  parseKaraWorld, parseKaraLevel, buildReplay, seekCells, karaStars, karaAssetNames, karaSpeakers, karaMessages,
  BLOCK, ITEM, BOX, CHIP, DOOR, LASER, ACID, EXIT, SWITCH, TARGET, TERMINAL, type KaraTrace,
} from '@/lib/kara/world'

describe('parseKaraWorld', () => {
  it('parses cells, Kara and pads short rows', () => {
    const w = parseKaraWorld('\n#####\n#>*B\n#####\n')
    expect(w.cols).toBe(5)
    expect(w.rows).toBe(3)
    expect(w.kara).toEqual({ x: 1, y: 1, d: 1 })
    expect(w.cells[1 * 5 + 2]).toBe(ITEM)
    expect(w.cells[1 * 5 + 3]).toBe(BOX)
    expect(w.cells[0]).toBe(BLOCK)
    expect(w.cells[1 * 5 + 4]).toBe(0)
  })

  it('maps obstacles, doors, lasers and floor objects', () => {
    const w = parseKaraWorld('#xTPLRY*BoOcDd=|~ESts')
    expect(w.cells.slice(0, 7)).toEqual(Array(7).fill(BLOCK))
    expect(w.look.slice(0, 7)).toEqual(['#', 'x', 'T', 'P', 'L', 'R', 'Y'])
    expect(w.cells.slice(7)).toEqual([ITEM, BOX, TARGET, BOX | TARGET, CHIP, DOOR, 0, LASER, LASER, ACID, EXIT, SWITCH, BLOCK | TERMINAL, 0])
    expect(w.look[13]).toBe('D') // open door keeps the door look
    expect(w.terminals).toEqual([[19, 0]])
    expect(w.chips).toEqual([[11, 0]])
  })

  it('places Kara on the first free cell facing east when missing', () => {
    expect(parseKaraWorld('#..').kara).toEqual({ x: 1, y: 0, d: 1 })
  })
})

describe('parseKaraLevel', () => {
  const level = parseKaraLevel(`#>.E#
===
#.>E#
---
goal: exit, collect, nonsense
energy: 12
memory: 5
id: w1-l1
log: Gerald hat reagiert. | speaker=WEBER | audio=w1.mp3
chip: gerald | Laborbuch | Gerald ist weg. | speaker=Weber
aurora.win: Beeindruckend. | audio=win.mp3
music: hum.mp3`)

  it('splits variants and parses config', () => {
    expect(level.variants).toHaveLength(2)
    expect(level.variants[1].kara.x).toBe(2)
    const c = level.config
    expect(c.goals).toEqual(['exit', 'collect'])
    expect([c.energy, c.memory, c.id, c.music]).toEqual([12, 5, 'w1-l1', 'hum.mp3'])
    expect(c.logs[0]).toEqual({ text: 'Gerald hat reagiert.', speaker: 'WEBER', audio: 'w1.mp3' })
    expect(c.chips[0]).toMatchObject({ id: 'gerald', title: 'Laborbuch', text: 'Gerald ist weg.' })
    expect(c.aurora.win).toEqual({ text: 'Beeindruckend.', speaker: 'AURORA', audio: 'win.mp3' })
  })

  it('lists assets and speakers', () => {
    expect(karaAssetNames(level).sort()).toEqual(['hum.mp3', 'w1.mp3', 'win.mp3'])
    expect(karaSpeakers(level).sort()).toEqual(['aurora', 'weber'])
  })

  it('parses intro lines in order with AURORA as default speaker', () => {
    const l = parseKaraLevel(`#>E#
---
goal: exit, logs
intro: Frachtraum B, sofort. | speaker=BRANDT | audio=b.mp3
intro: Er meint: bitte.`)
    expect(l.config.goals).toEqual(['exit', 'logs'])
    expect(l.config.intro).toEqual([
      { text: 'Frachtraum B, sofort.', speaker: 'BRANDT', audio: 'b.mp3' },
      { text: 'Er meint: bitte.', speaker: 'AURORA', audio: undefined },
    ])
    expect(karaMessages(l).slice(0, 2)).toEqual(l.config.intro)
    expect(karaAssetNames(l)).toEqual(['b.mp3'])
    expect(karaSpeakers(l).sort()).toEqual(['aurora', 'brandt'])
  })

  it('works without config or variants', () => {
    const l = parseKaraLevel('#>#')
    expect(l.variants).toHaveLength(1)
    expect(l.config.goals).toEqual([])
  })
})

describe('karaStars', () => {
  const config = parseKaraLevel('>\n---\ngoal: exit\nenergy: 10\nmemory: 3').config
  const run = (over: Partial<KaraTrace>): KaraTrace => ({ steps: [], error: null, energy: 5, memory: 3, goal: { reached: true, missing: [] }, ...over })
  it('counts goal, memory and energy', () => {
    expect(karaStars(run({}), config)).toBe(3)
    expect(karaStars(run({ memory: 4 }), config)).toBe(2)
    expect(karaStars(run({ memory: 4, energy: 11 }), config)).toBe(1)
    expect(karaStars(run({ goal: { reached: false, missing: ['exit'] } }), config)).toBe(0)
    expect(karaStars(run({ error: { line: 1, message: 'x' } }), config)).toBe(0)
  })
})

describe('replay', () => {
  const world = parseKaraWorld('>*B.')
  const trace: KaraTrace = {
    steps: [
      { l: 1, k: [1, 0, 1] },
      { l: 2, m: [[1, 0, ITEM, 0]], o: 'hi\n' },
      { l: 3, k: [2, 0, 1], m: [[2, 0, BOX, 0], [3, 0, 0, BOX]] },
    ],
    error: null,
    energy: 3,
    memory: 3,
  }

  it('fills Kara positions forward and accumulates output', () => {
    const r = buildReplay(world, trace)
    expect(r.length).toBe(3)
    expect(r.kara[2]).toEqual({ x: 1, y: 0, d: 1 })
    expect(r.output.slice(0, r.outputEnd[1])).toBe('')
    expect(r.output.slice(0, r.outputEnd[2])).toBe('hi\n')
  })

  it('seeks cells forward and back', () => {
    const cells = [...world.cells]
    seekCells(cells, world.cols, trace.steps, 0, 3)
    expect(cells).toEqual([0, 0, 0, BOX])
    seekCells(cells, world.cols, trace.steps, 3, 1)
    expect(cells).toEqual(world.cells)
  })
})

describe('remarkCodeEditor kara-world', () => {
  it('injects the grid into the target editor and removes the block', () => {
    const md = '```python editor id="k1"\nmove()\n```\n\n```kara-world for="k1" tile="32"\n#>.#\n```'
    const processor = unified().use(remarkParse).use(remarkCodeEditor)
    const tree = processor.parse(md) as any
    processor.runSync(tree)
    expect(tree.children).toHaveLength(1)
    const html: string = tree.children[0].value
    expect(html).toContain('data-kara-world="#&gt;.#"')
    expect(html).toContain('data-kara-tile="32"')
  })
})
