import { describe, it, expect } from 'vitest'
import { AURORA_DEFAULTS, AURORA_WANT, auroraLine, isAuroraDefault } from '@/lib/kara/aurora-defaults'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkCodeEditor from '@/lib/remark-plugins/code-editor'
import {
  parseKaraConfig, karaSeen, karaOutput, karaRunInput, buildCallStacks, karaSuiteStars, karaDoorAsk,
  parseKaraWorld, parseKaraLevel, buildReplay, seekCells, karaStars, karaAssetNames, karaSpeakers, karaMessages,
  BLOCK, ITEM, BOX, CHIP, DOOR, LASER, ACID, EXIT, SWITCH, TARGET, TERMINAL, BROKEN, AIRLOCK,
  AFTERMATH_STEPS, AFTERMATH_TEXT, karaAftermathInput, splitData, karaData, karaDataFiles, karaLimits, type KaraTrace,
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

describe('under: (cell under Kara\'s start)', () => {
  it('puts the legend char under Kara in every variant; ignores blocking chars and chips', () => {
    const level = parseKaraLevel('#>..#\n===\n#.>.#\n---\ngoal: exit\nunder: E')
    expect(level.config.under).toBe('E')
    for (const w of level.variants) {
      const i = w.kara.y * w.cols + w.kara.x
      expect(w.cells[i] & EXIT).toBeTruthy()
      expect(w.look[i]).toBe('E')
    }
    for (const ch of ['#', 'c', 't']) {
      const w = parseKaraLevel(`#>.#\n---\nunder: ${ch}`).variants[0]
      expect(w.cells[1]).toBe(0)
    }
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
  const text = (c: ReturnType<typeof cfg>, event: string, opts?: Parameters<typeof auroraLine>[2]) => auroraLine(c, event, opts)?.text

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

  it('fail.<goal> per first missing goal with a line; win.<limit> only from the level', () => {
    const c = cfg('aurora.fail: F.\naurora.fail.logs: L.\naurora.fail.3: F3.\naurora.win: W.\naurora.win.energy: E.')
    expect(text(c, 'fail', { missing: ['logs'] })).toBe('L.')
    expect(text(c, 'fail', { missing: ['exit', 'logs'] })).toBe('F.')
    expect(text(c, 'fail', { missing: ['exit'] })).toBe('F.')
    expect(text(c, 'fail', { missing: ['logs'], failStreak: 3 })).toBe('F3.')
    expect(text(c, 'win', { over: ['energy'] })).toBe('E.')
    expect(text(c, 'win', { over: ['memory'] })).toBe('W.')
    expect(text(cfg(''), 'win', { over: ['energy'] })).toBe(AURORA_DEFAULTS.win)
    expect(parseKaraConfig('forbid: for, while, if').forbid).toEqual(['for', 'while'])
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

describe('door.ask', () => {
  it('parses function = values (optional parentheses), repeatable, per variant', () => {
    const c = parseKaraConfig('door.ask: zaehle_faesser = 4 | 2 | 7\ndoor.ask: wand_hinten() = True\ndoor.ask: kaputt')
    expect(c.doorAsk).toEqual([{ fn: 'zaehle_faesser', expected: ['4', '2', '7'] }, { fn: 'wand_hinten', expected: ['True'] }])
    expect(karaDoorAsk(c, 1)).toEqual([['zaehle_faesser', '2'], ['wand_hinten', 'True']])
    expect(karaDoorAsk(c, 3)).toEqual([['zaehle_faesser', null], ['wand_hinten', 'True']])
    expect(c.aurora).toEqual({})
    expect(karaRunInput(parseKaraLevel('>D.'), 0).door_ask).toEqual([])
  })

  it('AURORA names the function, the answer and the expected kind; voice only for plain answers', () => {
    const vars = { name: 'zaehle_faesser', got: 'None', want: AURORA_WANT.number }
    const line = auroraLine(parseKaraConfig(''), 'error', { sub: 'door_code', vars })?.text
    expect(line).toBe('Die Tür hat zaehle_faesser() gefragt. Antwort: None. Erwartet war eine Zahl. Idealerweise die richtige.')
    expect(isAuroraDefault(line!)).toBe(true)
    expect(isAuroraDefault('Die Tür hat wand() gefragt. Antwort: 1. Erwartet war True oder False. Idealerweise die richtige.')).toBe(true)
    expect(isAuroraDefault("Die Tür hat f() gefragt. Antwort: 'Hallo Welt'. Erwartet war eine Zahl. Idealerweise die richtige.")).toBe(false)
    expect(auroraLine(parseKaraConfig(''), 'error', { sub: 'door_missing', vars: { name: 'f' } })?.text)
      .toBe('Die Tür fragt nach f(). Diese Funktion gibt es nicht. Noch nicht.')
    expect(auroraLine(parseKaraConfig(''), 'door.ok')).toBeUndefined()
    expect(auroraLine(parseKaraConfig('aurora.door.ok: Korrekt. Leider.'), 'door.ok')?.text).toBe('Korrekt. Leider.')
  })
})

describe('aftermath + archive config', () => {
  it('a grid after `=== aftermath` is the aftermath, not a variant', () => {
    const level = parseKaraLevel(`#>.E#\n===\n#>..E#\n=== aftermath\n.>B.q.a.\n---\ngoal: exit\naftermath.text: Nur kurz. | speaker=AURORA\naftermath.end: Wie vertraut.\naftermath.steps: 80\narchive: true`)
    expect(level.variants).toHaveLength(2)
    expect(level.aftermath?.cols).toBe(8)
    expect(level.aftermath?.look[4]).toBe('q')
    expect(level.aftermath!.cells[4] & (TARGET | BROKEN)).toBe(TARGET | BROKEN)
    expect(level.aftermath!.cells[6] & AIRLOCK).toBe(AIRLOCK)
    expect(level.config.aftermathText).toEqual({ text: 'Nur kurz.', speaker: 'AURORA', audio: undefined })
    expect(level.config.aftermathEnd?.text).toBe('Wie vertraut.')
    expect(level.config.archive).toBe(true)
    expect(karaAftermathInput(level)).toMatchObject({ max_steps: 80, goals: ['exit'], cols: 8 })
    expect(karaMessages(level).map(m => m.text)).toEqual(expect.arrayContaining(['Nur kurz.', 'Wie vertraut.']))
  })

  it('`aftermath:` takes a generate spec; the default card text is speakable', () => {
    const level = parseKaraLevel('#>.E#\n---\nid: w5-l3\naftermath: corridor len=6 count=3')
    expect(level.variants).toHaveLength(1)
    expect(level.aftermath?.cols).toBe(8) // len 6 + walls
    expect(karaAftermathInput(level)?.max_steps).toBe(AFTERMATH_STEPS)
    expect(karaMessages(level)).toContainEqual({ text: AFTERMATH_TEXT, speaker: 'AURORA' })
    expect(level.config.archive).toBeUndefined()
  })

  it('no aftermath: no input, no extra messages', () => {
    const level = parseKaraLevel('#>.E#\n---\ngoal: exit')
    expect(level.aftermath).toBeUndefined()
    expect(karaAftermathInput(level)).toBeNull()
    expect(karaMessages(level).some(m => m.text === AFTERMATH_TEXT)).toBe(false)
  })
})

describe('debug config', () => {
  it('parses debug: into / over, ignores other values', () => {
    expect(parseKaraLevel('#>E#\n---\ngoal: exit\ndebug: into').config.debug).toBe('into')
    expect(parseKaraLevel('#>E#\n---\ndebug: Over').config.debug).toBe('over')
    expect(parseKaraLevel('#>E#\n---\ndebug: maybe').config.debug).toBeUndefined()
    expect(parseKaraLevel('#>E#\n---\ngoal: exit').config.debug).toBeUndefined()
  })
})

describe('data: and looks: config', () => {
  it('splits data values on | only outside quotes and brackets', () => {
    expect(splitData('["a|b", "c"] | [1, 2] | \'x|y\' | @f.json')).toEqual(['["a|b", "c"]', '[1, 2]', "'x|y'", '@f.json'])
  })

  it('parses data lines per variant and resolves @files', () => {
    const c = parseKaraConfig('data: postfach = ["A"] | ["B", "C"]\ndata: m = @m1.json | @m2.json\ndata: n = 3\nlooks: 40\ndata: 1kaputt = 2')
    expect(c.looks).toBe(40)
    expect(c.data.map(d => d.name)).toEqual(['postfach', 'm', 'n'])
    expect(karaDataFiles(c)).toEqual(['m1.json', 'm2.json'])
    expect(karaData(c, 1, { 'm2.json': '{"k": 1}' })).toEqual([['postfach', '["B", "C"]'], ['m', '{"k": 1}'], ['n', '3']])
    expect(karaData(c, 0)).toEqual([['postfach', '["A"]'], ['m', null], ['n', '3']])
    expect(karaData(c, 2)).toEqual([['postfach', null], ['m', null], ['n', '3']])
    const level = parseKaraLevel('#>E#\n---\ngoal: exit\ndata: m = @m1.json')
    expect(karaAssetNames(level)).toEqual(['m1.json'])
    expect(karaRunInput(level, 0, { 'm1.json': '[1]' }).data).toEqual([['m', '[1]']])
  })

  it('looks limit is part of the energy star; karaLimits shows it', () => {
    const config = parseKaraConfig('goal: exit\nenergy: 10\nlooks: 5')
    const t: KaraTrace = { steps: [], error: null, energy: 8, memory: 3, goal: { reached: true, missing: [] }, looks: 6 }
    expect(karaStars(t, config)).toBe(2)
    expect(karaStars({ ...t, looks: 5 }, config)).toBe(3)
    expect(karaLimits(t, config)).toBe('Memory 3 · Energy 8/10 · Looks 6/5')
    expect(karaLimits({ ...t, looks: undefined }, parseKaraConfig('goal: exit'))).toBe('Memory 3 · Energy 8')
  })
})

describe('callstack config', () => {
  it('parses callstack: on and passes it to the runner', () => {
    const level = parseKaraLevel('#>E#\n---\ngoal: exit\ncallstack: on')
    expect(level.config.callstack).toBe(true)
    expect(karaRunInput(level, 0).callstack).toBe(true)
    const off = parseKaraLevel('#>E#\n---\ngoal: exit')
    expect(off.config.callstack).toBeUndefined()
    expect('callstack' in karaRunInput(off, 0)).toBe(false)
    expect(parseKaraLevel('#>E#\n---\ncallstack: off').config.callstack).toBe(false)
  })

  it('buildCallStacks decodes deltas and keeps only the newest cap labels', () => {
    const steps = [
      { l: 1 },
      { l: 2, cs: [0, 'a(n=3)'] as [number, ...string[]] },
      { l: 3, cs: [1, 'a(n=2)', 'a(n=1)'] as [number, ...string[]] },
      { l: 4 },
      { l: 5, cs: [1] as [number, ...string[]] },
    ]
    const st = buildCallStacks(steps, 2)
    expect(st.map(s => s.depth)).toEqual([0, 0, 1, 3, 3, 1])
    expect(st[3].top).toEqual(['a(n=2)', 'a(n=1)'])
    expect(st[4]).toBe(st[3])
    expect(st[5].top).toEqual(['a(n=3)'])
  })
})

describe('dark: and steps:', () => {
  it('parses dark and steps; steps becomes max_steps of the run input', () => {
    const level = parseKaraLevel('#####\n#>..#\n#####\n---\ndark: 1\nsteps: 300')
    expect(level.config.dark).toBe(1)
    expect(karaRunInput(level, 0).max_steps).toBe(300)
    expect(karaRunInput(parseKaraLevel('###\n#>#\n###'), 0).max_steps).toBeUndefined()
  })

  it('karaSeen: first position a cell came within r of MOP-7', () => {
    const w = parseKaraWorld('#######\n#>....#\n#######')
    const seen = karaSeen(w, [w.kara, { x: 2, y: 1, d: 1 }, { x: 3, y: 1, d: 1 }], 1)
    const at = (x: number, y: number) => seen[y * w.cols + x]
    expect(at(0, 0)).toBe(0)
    expect(at(3, 1)).toBe(1)
    expect(at(4, 1)).toBe(2)
    expect(at(5, 1)).toBe(Infinity)
  })
})
