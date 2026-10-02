import { describe, it, expect } from 'vitest'
import { AURORA_DEFAULTS, auroraLine, isAuroraDefault } from '@/lib/kara/aurora-defaults'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodeEditor from '@/lib/remark-plugins/code-editor'
import {
  parseKaraConfig, karaOutput, karaRunInput, karaSuiteStars,
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

describe('auroraLine', () => {
  const cfg = (src: string) => parseKaraConfig(src)
  const text = (c: ReturnType<typeof cfg>, event: string, opts?: { sub?: string; failStreak?: number }) => auroraLine(c, event, opts)?.text

  it('parses aurora.error.<sub> and aurora.fail.3 keys', () => {
    const c = cfg('aurora.error.no_item: Leer.\naurora.fail.3: Dritter.')
    expect(c.aurora['error.no_item']).toEqual({ text: 'Leer.', speaker: 'AURORA', audio: undefined })
    expect(c.aurora['fail.3']?.text).toBe('Dritter.')
  })

  it('error: level sub → level error → default sub → default error', () => {
    const both = cfg('aurora.error.wall: W.\naurora.error: E.')
    expect(text(both, 'error', { sub: 'wall' })).toBe('W.')
    expect(text(both, 'error', { sub: 'name' })).toBe('E.')
    expect(text(both, 'error')).toBe('E.')
    const none = cfg('')
    expect(text(none, 'error', { sub: 'wall' })).toBe(AURORA_DEFAULTS['error.wall'])
    expect(text(none, 'error', { sub: 'unknown' })).toBe(AURORA_DEFAULTS.error)
    expect(text(none, 'error')).toBe(AURORA_DEFAULTS.error)
  })

  it('other events: level line, else German default, else undefined', () => {
    expect(text(cfg('aurora.win: Ja.'), 'win')).toBe('Ja.')
    expect(text(cfg(''), 'win')).toBe('Auftrag erledigt. Ich bin fast beeindruckt.')
    expect(text(cfg(''), 'loop')).toBe(AURORA_DEFAULTS.loop)
    expect(text(cfg(''), 'start')).toBeUndefined()
  })

  it('fail.3 replaces fail from the 3rd failed run in a row', () => {
    const c = cfg('aurora.fail: F.\naurora.fail.3: F3.')
    expect(text(c, 'fail', { failStreak: 2 })).toBe('F.')
    expect(text(c, 'fail', { failStreak: 3 })).toBe('F3.')
    expect(text(c, 'fail', { failStreak: 5 })).toBe('F3.')
    expect(text(cfg(''), 'fail', { failStreak: 3 })).toBe(AURORA_DEFAULTS.fail)
  })

  it('lint.<code>: level override, placeholders {line} / {name} filled', () => {
    const vars = { line: 7, name: 'turn_right' }
    expect(auroraLine(cfg(''), 'lint.bare_call', { vars })?.text)
      .toBe('Zeile 7: turn_right ohne (). Sie haben den Befehl erwähnt, nicht ausgeführt.')
    expect(auroraLine(cfg('aurora.lint.bare_call: {name}, Zeile {line}. Klammern.'), 'lint.bare_call', { vars })?.text)
      .toBe('turn_right, Zeile 7. Klammern.')
    expect(auroraLine(cfg(''), 'error', { sub: 'forbidden', vars: { name: 'exec' } })?.text)
      .toBe('exec? Mikroweich nennt das Lizenzverletzung. Schreiben Sie es aus.')
  })
})

describe('isAuroraDefault', () => {
  it('accepts defaults with filled placeholders, nothing else', () => {
    expect(isAuroraDefault(AURORA_DEFAULTS.win)).toBe(true)
    expect(isAuroraDefault('Zeile 12: stufe ohne (). Sie haben den Befehl erwähnt, nicht ausgeführt.')).toBe(true)
    expect(isAuroraDefault('eval? Mikroweich nennt das Lizenzverletzung. Schreiben Sie es aus.')).toBe(true)
    expect(isAuroraDefault('Zeile x: stufe ohne (). Sie haben den Befehl erwähnt, nicht ausgeführt.')).toBe(false)
    expect(isAuroraDefault('Zeile 1: a b ohne (). Sie haben den Befehl erwähnt, nicht ausgeführt.')).toBe(false)
    expect(isAuroraDefault('Irgendein Text.')).toBe(false)
  })
})

describe('per-variant output and suite stars', () => {
  const level = parseKaraLevel(`#>*#
===
#>**#
===
#>***#
---
output: 1 | 2 | 3
memory: 4`)

  it('maps `output: a | b | c` to variants by index', () => {
    expect(level.config.output).toEqual(['1', '2', '3'])
    expect(level.config.goals).toEqual(['output'])
    expect([0, 1, 2, 3].map(v => karaOutput(level.config, v))).toEqual(['1', '2', '3', undefined])
    expect(karaRunInput(level, 1)).toMatchObject({ cols: 5, goals: ['output'], output: '2' })
  })

  it('applies a single output value to every variant', () => {
    const c = parseKaraConfig('output: 10')
    expect([karaOutput(c, 0), karaOutput(c, 5)]).toEqual(['10', '10'])
    expect(karaOutput(parseKaraConfig('goal: exit'), 0)).toBeUndefined()
  })

  it('suite stars are the minimum over all variants', () => {
    const t = (memory: number, reached = true): KaraTrace => ({ steps: [], error: null, energy: 0, memory, goal: { reached, missing: [] } })
    expect(karaSuiteStars([t(3), t(4)], level.config)).toBe(3)
    expect(karaSuiteStars([t(3), t(9)], level.config)).toBe(2)
    expect(karaSuiteStars([t(3), t(3, false)], level.config)).toBe(0)
    expect(karaSuiteStars([t(3), null], level.config)).toBe(0)
    expect(karaSuiteStars([], level.config)).toBe(0)
  })
})
