/**
 * Runs the real kara.py (KARA_MODULE_SOURCE) in local CPython, like
 * kara-kurs/check.ts does, to check the trace shape: one action per step.
 * Skipped when python3 is not on PATH.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { KARA_MODULE_SOURCE } from '@/lib/kara/kara-module'
import { parseKaraWorld, parseKaraLevel, buildReplay, buildCallStacks, karaAftermathInput, karaRunInput, karaStars, karaSuiteStars, seekMarks, DOOR, type KaraTrace } from '@/lib/kara/world'

const hasPython = (() => {
  try { execFileSync('python3', ['--version']); return true } catch { return false }
})()

const BEFEHLE = `def umdrehen():
    turn_left()
    turn_left()


def drei_vor():
    move()
    move()
    move()


def stufe():
    turn_right()
    move()
    turn_left()
    move()


def endlos():
    while True:
        turn_left()
`

let dir = ''
const world = parseKaraWorld(`
#########
#>......#
#.......#
#.......#
#########`)

function run(code: string, input: object = { ...world, goals: [] }): KaraTrace {
  fs.writeFileSync(path.join(dir, '__kara_world.json'), JSON.stringify(input))
  fs.writeFileSync(path.join(dir, '__kara_student.py'), code)
  return JSON.parse(execFileSync('python3', ['-c', 'import kara; print(kara._run())'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 }).toString())
}

describe.skipIf(!hasPython)('kara.py trace: one action per step', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-module-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
    fs.writeFileSync(path.join(dir, 'befehle.py'), BEFEHLE)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('drei_vor() from a helper module replays as 3 steps on the call line', () => {
    const t = run('from befehle import *\n\ndrei_vor()\n')
    const calls = t.steps.filter(s => s.l === 3)
    expect(calls.map(s => s.sub)).toEqual([1, 2, 3])
    expect(calls.map(s => s.k)).toEqual([[2, 1, 1], [3, 1, 1], [4, 1, 1]])
    expect(calls.map(s => [s.f, s.fl, s.fn])).toEqual([
      ['befehle.py', 7, 'drei_vor'], ['befehle.py', 8, 'drei_vor'], ['befehle.py', 9, 'drei_vor'],
    ])
    expect(t.energy).toBe(3)
    const r = buildReplay(world, t)
    expect(r.subTotal.slice(-3)).toEqual([3, 3, 3])
    expect(t.steps.some(s => 'a' in s)).toBe(false)
  })

  it('steps record the call depth (d): helper and recursive student functions', () => {
    const t = run('from befehle import *\n\ndrei_vor()\n')
    expect(t.steps.filter(s => s.l === 3).map(s => s.d)).toEqual([1, 1, 1])
    expect(t.steps.filter(s => s.l === 1).every(s => s.d === undefined)).toBe(true)
    const r = run('def rec(n):\n    if n > 0:\n        move()\n        rec(n - 1)\n\nrec(3)\n')
    expect(r.steps.filter(s => s.l === 3).map(s => s.d)).toEqual([1, 2, 3])
    expect(r.steps.find(s => s.l === 6)?.d).toBeUndefined()
  })

  it('stufe() yields 4 steps, each moving at most one cell or turning once', () => {
    const t = run('from befehle import *\nstufe()\n')
    const calls = t.steps.filter(s => s.l === 2)
    expect(calls).toHaveLength(4)
    const replay = buildReplay(world, t)
    for (let i = 1; i <= replay.length; i++) {
      const a = replay.kara[i - 1], b = replay.kara[i]
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      expect(dist + (a.d !== b.d ? 1 : 0)).toBeLessThanOrEqual(1)
    }
  })

  it('two moves on one student line yield 2 steps without a helper frame', () => {
    const t = run('move(); move()\n')
    expect(t.steps.map(s => [s.l, s.sub, s.f])).toEqual([[1, 1, undefined], [1, 2, undefined]])
  })

  it('a single action keeps no sub, sensors stay on their step', () => {
    const t = run('move()\nif not wall_front(): move(); move(); wall_front()\n')
    expect(t.steps.map(s => s.sub)).toEqual([undefined, 1, 2])
    expect(buildReplay(world, t).subTotal).toEqual([0, 2, 2])
    expect(t.steps[1].s).toEqual([['wall_front', false]])
    expect(t.steps[2].s).toEqual([['wall_front', false]])
  })

  it('an endless action loop inside a helper hits the step limit', () => {
    const t = run('from befehle import *\nendlos()\n')
    expect(t.error?.kind).toBe('loop')
    expect(t.error?.line).toBe(2)
  })

  it("goal 'logs' needs every terminal read", () => {
    const logs = parseKaraWorld('#t#\n#^#\n#t#')
    const runLogs = (code: string): KaraTrace => {
      fs.writeFileSync(path.join(dir, '__kara_world.json'), JSON.stringify({ ...logs, goals: ['logs'] }))
      fs.writeFileSync(path.join(dir, '__kara_student.py'), code)
      return JSON.parse(execFileSync('python3', ['-c', 'import kara; print(kara._run())'], { cwd: dir }).toString())
    }
    expect(runLogs('read_log()\n').goal).toEqual({ reached: false, missing: ['logs'] })
    expect(runLogs('read_log()\nread_log()\n').goal?.reached).toBe(false)
    expect(runLogs('read_log()\nturn_left()\nturn_left()\nread_log()\n').goal).toEqual({ reached: true, missing: [] })
  })

  it('classifies errors with error.sub', () => {
    const sub = (code: string) => run(code).error?.sub
    expect(run('turn_left()\nmove()\n').error).toMatchObject({ kind: 'kara', sub: 'wall', line: 2, message: "KaraError: MOP-7 can't move: there is a wall in front." })
    expect(sub('remove_barrel()\n')).toBe('no_item')
    expect(sub('press_switch()\n')).toBe('no_switch')
    expect(sub('read_log()\n')).toBe('no_terminal')
    expect(sub('mvoe()\n')).toBe('name')
    expect(sub('from befehel import *\n')).toBe('module')
    // name lets the editor flash its toolbox tab (file-scopes.ts isToolboxModuleError)
    expect(run('from befehel import *\n').error?.name).toBe('befehel')
    expect(sub('if True:\nmove()\n')).toBe('indent')
    expect(sub('move(\n')).toBe('syntax')
    expect(sub('move(3)\n')).toBe('type')
    expect(sub('def f():\n    f()\nf()\n')).toBe('recursion')
    expect(run('x = 1 / 0\n').error).toMatchObject({ kind: 'python', sub: null })
  })
})

describe.skipIf(!hasPython)('kara.py lints', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-lint-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
    fs.writeFileSync(path.join(dir, 'befehle.py'), BEFEHLE)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const lints = (code: string) => run(code).lints?.map(l => [l.line, l.code, l.name])

  it('clean programs have no lints', () => {
    expect(lints('def zwei():\n    move()\n    move()\n\nzwei()\nif not wall_front():\n    move()\n')).toEqual([])
    expect(lints('from befehle import *\ndrei_vor()\n')).toEqual([])
  })

  it('bare_call: a command or own function without ()', () => {
    expect(lints('move()\nturn_right\n')).toEqual([[2, 'bare_call', 'turn_right']])
    expect(lints('def stufe():\n    move()\nstufe\n')).toEqual([[3, 'bare_call', 'stufe']])
    expect(lints('from befehle import drei_vor\ndrei_vor\n')).toEqual([[2, 'bare_call', 'drei_vor']])
    expect(lints('x = 3\nx\n')).toEqual([])
  })

  it('never_called: a top-level def nobody calls (own recursion does not count)', () => {
    expect(lints('def umdrehen():\n    turn_left()\n    turn_left()\n')).toEqual([[1, 'never_called', 'umdrehen']])
    expect(lints('def f():\n    f()\n')).toEqual([[1, 'never_called', 'f'], [2, 'indented_call', 'f']])
    expect(lints('def a():\n    move()\ndef b():\n    a()\nb()\n')).toEqual([])
  })

  it('indented_call: the main program indented into the last def (Enter, Enter keeps the indent)', () => {
    // w1-l4: stufe() typed under the body after a blank line
    const stufe = 'def stufe():\n    move()\n    turn_right()\n    move()\n    turn_left()\n'
    expect(lints(stufe + '\n    stufe()\n    stufe()\n')).toEqual([[1, 'never_called', 'stufe'], [7, 'indented_call', 'stufe']])
    // no gap, but a call of an own def
    expect(lints(stufe + '    stufe()\n')).toEqual([[1, 'never_called', 'stufe'], [6, 'indented_call', 'stufe']])
    // w1-l3: calls of the other def after a comment line
    const l3 = 'def umdrehen():\n    turn_left()\n    turn_left()\n\ndef vor():\n    move()\n    umdrehen()\n    move()\n\n    # Ihre Aufrufe:\n    vor()\n    move()\n'
    expect(lints(l3)).toEqual([[5, 'never_called', 'vor'], [11, 'indented_call', 'vor']])
    // a real call at module level: no finding
    expect(lints(stufe + '\nstufe()\n')).toEqual([])
    // a def calling another def, no gap, but the module calls something: fine
    expect(lints('def a():\n    move()\ndef b():\n    a()\nb()\n')).toEqual([])
  })

  it('tamper and locked loops refuse the run', () => {
    const t = run('kara._w.x = 5\nmove()\n')
    expect(t.error).toMatchObject({ kind: 'python', sub: 'tamper', name: '_w', line: 1 })
    expect(t.steps).toEqual([])
    expect(run('from kara import _w\n').error?.sub).toBe('tamper')
    const loop = (code: string) => run(code, { ...world, goals: [], forbid: ['for', 'while'] }).error
    expect(loop('move()\nfor i in range(3):\n    move()\n')).toMatchObject({ sub: 'locked', name: 'for', line: 2 })
    expect(loop('while not wall_front():\n    move()\n')).toMatchObject({ sub: 'locked', name: 'while', line: 1 })
    expect(loop('x = [move() for i in range(2)]\n')).toMatchObject({ sub: 'locked', name: 'for', line: 1 })
    expect(run('for i in range(2):\n    move()\n').error).toBeNull()
  })

  it('sensor_no_call: a sensor or own function as a bare condition', () => {
    expect(lints('if wall_front:\n    turn_left()\n')).toEqual([[1, 'sensor_no_call', 'wall_front']])
    expect(lints('while not wall_front:\n    move()\n')).toEqual([[1, 'sensor_no_call', 'wall_front']])
    expect(lints('if on_exit() or wallFront:\n    pass\n')).toEqual([[1, 'sensor_no_call', 'wallFront']])
    expect(lints('if wall_front():\n    pass\nelif on_barrel:\n    pass\n')).toEqual([[3, 'sensor_no_call', 'on_barrel']])
    const t = run('n = 0\nwhile not wall_front:\n    move()\n    n = n + 1\n')
    expect(t.lints).toEqual([{ line: 2, code: 'sensor_no_call', name: 'wall_front' }])
    expect(t.steps.some(s => s.k)).toBe(false) // the program really ran: not True → loop never entered
  })

  it('no_return: a printing function used as a condition or in a comparison', () => {
    const def = 'def frei():\n    print(not wall_front())\n'
    expect(lints(def + 'if frei():\n    move()\n')).toEqual([[3, 'no_return', 'frei']])
    expect(lints(def + 'if frei() == True:\n    move()\n')).toEqual([[3, 'no_return', 'frei']])
    expect(lints(def + 'frei()\n')).toEqual([])
    expect(lints('def frei():\n    print(1)\n    return not wall_front()\nif frei():\n    move()\n')).toEqual([])
  })

  it('forbidden: exec & co. refuse the whole run', () => {
    const t = run('move()\nexec("move()\\n" * 3)\n')
    expect(t.error).toMatchObject({ kind: 'python', sub: 'forbidden', name: 'exec', line: 2, message: 'ForbiddenError: exec is not available in Kara programs.' })
    expect(t.steps).toEqual([])
    expect(t.energy).toBe(0)
    expect(run('f = eval\n').error?.name).toBe('eval')
    expect(run('import builtins\nbuiltins.setattr(1, "a", 2)\n').error?.name).toBe('setattr')
    expect(run('from builtins import compile\n').error?.name).toBe('compile')
    expect(run('globals()["x"] = 1\n').error?.sub).toBe('forbidden')
    expect(run('__import__("os")\n').error?.sub).toBe('forbidden')
  })
})


describe.skipIf(!hasPython)('Test all worlds: per-variant output', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-suite-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  // Count the barrels in the corridor and print the number (w1-l5 style).
  const level = parseKaraLevel(`#>.*..*E#
===
#>*E#
===
#>***.*E#
---
output: 2 | 1 | 4`)
  const suite = (code: string) => level.variants.map((_, v) => run(code, karaRunInput(level, v)))

  it('a hardcoded print wins one world but not the suite', () => {
    const traces = suite('print(2)\n')
    expect(traces.map(t => karaStars(t, level.config) > 0)).toEqual([true, false, false])
    expect(karaSuiteStars(traces, level.config)).toBe(0)
  })

  it('a counting program wins every world', () => {
    const code = 'n = 0\nwhile not on_exit():\n    move()\n    if on_barrel():\n        n += 1\nprint(n)\n'
    expect(karaSuiteStars(suite(code), level.config)).toBe(3)
  })

  it('a variant without an expected output never meets the output goal', () => {
    const t = run('print("")\n', { ...level.variants[0], goals: ['output'] })
    expect(t.goal).toEqual({ reached: false, missing: ['output'] })
  })
})

describe.skipIf(!hasPython)('door codes (door.ask)', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-door-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
    fs.writeFileSync(path.join(dir, 'befehle.py'), 'def antwort():\n    return 4\n')
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  // MOP-7 two cells west of the door; the exit is behind it.
  const level = parseKaraLevel(`#>.D.E#
===
#>.D.E#
---
goal: exit
door.ask: antwort = 4 | 7`)
  const at = (v: number) => karaRunInput(level, v)
  const walk = 'while not on_exit():\n    move()\n'

  it('passes the per-variant expected answer to the runner', () => {
    expect(at(0).door_ask).toEqual([['antwort', '4']])
    expect(at(1).door_ask).toEqual([['antwort', '7']])
  })

  it('a right answer opens the door: one step with the answer, then the move', () => {
    const t = run(`def antwort():\n    return 4\n\n${walk}`, at(0))
    expect(t.error).toBeNull()
    expect(t.goal?.reached).toBe(true)
    const i = t.steps.findIndex(s => s.q)
    expect(t.steps[i]).toMatchObject({ l: 5, q: ['antwort', '4', true], v: [['door', 0]] })
    expect(t.steps[i].m).toEqual([[3, 0, DOOR, 0]])
    expect(t.steps[i].k).toBeUndefined()
    expect(t.steps[i + 1]).toMatchObject({ l: 5, k: [3, 0, 1] })
    expect(t.steps.filter(s => s.q)).toHaveLength(1) // the open door does not ask again
    expect(t.energy).toBe(4)
    expect(t.lints).toEqual([]) // only the door calls antwort(): not never_called
    expect(run('def antwort():\n    return 4\n', { ...level.variants[0], goals: [] }).lints?.[0]?.code).toBe('never_called')
  })

  it('the same hardcoded answer fails in the other world (door_code with got/want)', () => {
    const t = run(`def antwort():\n    return 4\n\n${walk}`, at(1))
    expect(t.error).toMatchObject({ kind: 'kara', sub: 'door_code', name: 'antwort', got: '4', want: 'number', line: 5 })
    expect(t.steps.at(-1)).toMatchObject({ l: 5, q: ['antwort', '4', false] })
  })

  it('print instead of return answers None', () => {
    const t = run(`def antwort():\n    print(7)\n\n${walk}`, at(1))
    expect(t.error).toMatchObject({ sub: 'door_code', got: 'None', want: 'number' })
    expect(t.steps.some(s => s.o === '7\n' && s.l === 2)).toBe(true) // the function body was traced
  })

  it('a missing function is door_missing', () => {
    const t = run(walk, at(0))
    expect(t.error).toMatchObject({ kind: 'kara', sub: 'door_missing', name: 'antwort', line: 2 })
    expect(t.energy).toBe(1) // the refused move costs nothing
  })

  it('finds a function imported from befehle.py', () => {
    const t = run(`from befehle import antwort\n${walk}`, at(0))
    expect(t.goal?.reached).toBe(true)
  })

  it('actions inside the function cost energy and their side effects stay', () => {
    // Turns around and does not turn back: the door opens, the move goes west.
    const t = run('def antwort():\n    turn_left()\n    turn_left()\n    return 4\n\nmove()\nmove()\n', at(0))
    expect(t.error).toBeNull()
    expect(t.energy).toBe(4)
    expect(t.steps.at(-1)?.k).toEqual([1, 0, 3])
    expect(t.steps.filter(s => s.l === 2 || s.l === 3).map(s => s.k?.[2])).toEqual([0, 3])
  })

  it('True/False must be a bool; a door function moving into another door is the plain door error', () => {
    const bool = parseKaraLevel('#>D.E#\n---\ngoal: exit\ndoor.ask: wand = True')
    expect(run(`def wand():\n    return 1\n\n${walk}`, karaRunInput(bool, 0)).error).toMatchObject({ sub: 'door_code', got: '1', want: 'bool' })
    expect(run(`def wand():\n    return wall_front() or True\n\n${walk}`, karaRunInput(bool, 0)).goal?.reached).toBe(true)
    expect(run(`def wand():\n    move()\n    return True\n\n${walk}`, karaRunInput(bool, 0)).error).toMatchObject({ sub: 'door', line: 2 })
  })

  it('several doors ask the door.ask lines in reading order; the last line covers the rest', () => {
    const two = parseKaraLevel('#>D.D.D.E#\n---\ngoal: exit\ndoor.ask: eins = 1\ndoor.ask: zwei = 2')
    const t = run(`def eins():\n    return 1\n\ndef zwei():\n    return 2\n\n${walk}`, karaRunInput(two, 0))
    expect(t.goal?.reached).toBe(true)
    expect(t.steps.filter(s => s.q).map(s => s.q)).toEqual([['eins', '1', true], ['zwei', '2', true], ['zwei', '2', true]])
  })

  it('a level without door.ask keeps the closed-door error', () => {
    expect(run(walk, karaRunInput(parseKaraLevel('#>D.E#\n---\ngoal: exit'), 0)).error?.sub).toBe('door')
  })
})

describe.skipIf(!hasPython)('kara.py aftermath: broken target, airlock, step limit', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-aftermath-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
  })
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const level = parseKaraLevel(`
#######
#>B..o#
#######
=== aftermath
.>B.q.a.
---
goal: boxes
aftermath.steps: 120`)
  const loop = 'while not on_target():\n    move()\n'

  it('wins the level, then loops in the aftermath: on_target() is False on q, the box is gone in the airlock', () => {
    const win = run('move()\nmove()\nmove()\n', karaRunInput(level, 0))
    expect(win.goal?.reached).toBe(true)
    const input = karaAftermathInput(level)!
    expect(input.max_steps).toBe(120)
    const t = run(loop, input)
    expect(t.error).toMatchObject({ kind: 'loop' })
    expect(t.error?.message).toContain('120 steps')
    expect(t.steps.length).toBe(120)
    // Sensor on the broken target cell (x=4) said False.
    const onQ = t.steps.find(s => s.k?.[0] === 4)
    const after = t.steps[t.steps.indexOf(onQ!) + 1]
    expect(after.s).toEqual([['on_target', false]])
    // The box was pushed onto the airlock (x=6) and removed: no mutation ever sets a box there.
    const boxes = t.steps.flatMap(s => s.m ?? []).filter(([, , b, a]) => (b ^ a) & 4)
    expect(boxes.some(([x, , , a]) => x === 5 && !(a & 4))).toBe(true)
    expect(boxes.some(([x, , , a]) => x === 6 && a & 4)).toBe(false)
  })

  it('without max_steps the normal limit applies', () => {
    const t = run('move()\n', karaRunInput(level, 0))
    expect(t.error).toBeNull()
  })
})

describe.skipIf(!hasPython)('kara.py data sensors and level data', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-data-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const level = parseKaraLevel(`
##########
#>.*Bs~=t#
#.xD.S.E.#
##########
===
#####
#v..#
#*..#
#####
---
goal: output
output: ok
looks: 3
data: postfach = ["Rechnung", "Spam|Gerald"] | ['Spam']
data: wo = (2, 1)
data: manifest = @m.json`)

  it('scan(), position(), ship_map() and look_at() return data and record repr chips', () => {
    const files = { 'm.json': '{"kisten": 4}' }
    const code = [
      'print(scan())',
      'print(position())',
      'karte = ship_map()',
      'print(karte[1], karte[2][3])',
      'print(look_at(4, 1), look_at(0, 0))',
      'move()\nmove()\nmove()',
      'print(ship_map()[1])',
      'print("ok")',
    ].join('\n')
    const t = run(code, karaRunInput(level, 0, files))
    expect(t.error).toBeNull()
    const out = t.steps.map(s => s.o ?? '').join('').split('\n')
    expect(out[0]).toBe("['leer', 'fass', 'kiste', 'schleim', 'saeure', 'laser', 'terminal']")
    expect(out[1]).toBe("(1, 1, 'O')")
    expect(out[2]).toBe('#..*Bs~=t# D') // MOP-7 not drawn: its own cell shows floor
    expect(out[3]).toBe('B #')
    // MOP-7 pushed the box onto the slime cell: the map shows the current state.
    expect(out[4]).toBe('#..*.B~=t#')
    expect(t.looks).toBe(2)
    expect(t.energy).toBe(3)
    const chips = t.steps.flatMap(s => s.s ?? [])
    expect(chips[0]).toEqual(['scan', "['leer', 'fass', 'kiste', 'schleim', 'saeure', 'laser', 'terminal']"])
    expect(chips[1]).toEqual(['position', "(1, 1, 'O')"])
    expect(chips.find(c => c[0] === 'ship_map')![1]).toBe("['##########', '#..*Bs~=t#', '#.xD.S.E.#', '##########']")
    expect(chips.filter(c => c[0] === 'look_at')).toEqual([['look_at', "'B'"], ['look_at', "'#'"]])
  })

  it('scan() stops at a closed door (last entry) and position() reports the direction letter', () => {
    const t = run('turn_right()\nprint(position())\nprint(scan())\nturn_left()\nprint(scan())', karaRunInput(parseKaraLevel('#####\n#.>D.#\n#...E#\n#####'), 0))
    const out = t.steps.map(s => s.o ?? '').join('').split('\n')
    expect(out[0]).toBe("(2, 1, 'S')")
    expect(out[1]).toBe("['leer']")
    expect(out[2]).toBe("['tuer']")
  })

  it('injects data: per variant, JSON or Python literal, | inside a string does not split, @file from files', () => {
    const files = { 'm.json': '{"kisten": 4}' }
    const code = 'print(postfach, wo, manifest["kisten"])\nprint("ok")\n'
    const out0 = run(code, karaRunInput(level, 0, files)).steps.map(s => s.o ?? '').join('')
    expect(out0.split('\n')[0]).toBe("['Rechnung', 'Spam|Gerald'] (2, 1) 4")
    const out1 = run(code, karaRunInput(level, 1, files)).steps.map(s => s.o ?? '').join('')
    expect(out1.split('\n')[0]).toBe("['Spam'] (2, 1) 4")
  })

  it('a missing @file stops the run with a ValueError naming the variable', () => {
    const t = run('print("ok")\n', karaRunInput(level, 0))
    expect(t.error).toMatchObject({ kind: 'python' })
    expect(t.error?.message).toContain('manifest')
    expect(t.steps.length).toBe(0)
  })

  it('look_at() outside the grid is an IndexError; looks over the limit cost the energy star', () => {
    const t = run('look_at(10, 0)\n', karaRunInput(level, 0, { 'm.json': '1' }))
    expect(t.error?.message).toMatch(/^IndexError: look_at\(10, 0\) is outside the ship \(10 x 4\)/)
    const many = run('for i in range(4):\n    look_at(i, 0)\nprint("ok")\n', karaRunInput(level, 0, { 'm.json': '1' }))
    expect(many.looks).toBe(4)
    expect(karaStars(many, level.config)).toBe(2)
    const few = run('look_at(0, 0)\nprint("ok")\n', karaRunInput(level, 0, { 'm.json': '1' }))
    expect(karaStars(few, level.config)).toBe(3)
  })
})

describe.skipIf(!hasPython)('kara.py marks, field costs, music switch', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kara-marks-test-'))
    fs.writeFileSync(path.join(dir, 'kara.py'), KARA_MODULE_SOURCE)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const level = parseKaraLevel(`
#######
#>ss.E#
#.....#
#######
---
goal: exit
costs: s=3, o=2`)

  it('parses costs and passes them to the runner', () => {
    expect(level.config.costs).toEqual({ s: 3, o: 2 })
    expect(karaRunInput(level, 0).costs).toEqual({ s: 3, o: 2 })
    expect(karaRunInput(parseKaraLevel('#>E#'), 0)).not.toHaveProperty('costs')
  })

  it('a move onto slime costs 3, turns stay 1; the detour is cheaper', () => {
    const straight = run('for i in range(4):\n    move()\n', karaRunInput(level, 0))
    expect(straight.goal?.reached).toBe(true)
    expect(straight.energy).toBe(3 + 3 + 1 + 1)
    const detour = run('turn_right()\nmove()\nturn_left()\nfor i in range(4):\n    move()\nturn_left()\nmove()\n', karaRunInput(level, 0))
    expect(detour.goal?.reached).toBe(true)
    expect(detour.energy).toBe(1 + 1 + 1 + 4 + 1 + 1)
    // a refused move costs only the 1 of the action
    const wall = run('turn_left()\nmove()\n', karaRunInput(level, 0))
    expect(wall.error?.sub).toBe('wall')
    expect(wall.energy).toBe(2)
  })

  it('mark / mark_at / marked: free, recorded per step, replayable with seekMarks', () => {
    const code = 'mark(0)\nfor x in range(2, 5):\n    mark_at(x, 1, x - 1)\nprint(marked())\nmove()\nprint(marked())\nmark(None)\n'
    const t = run(code, karaRunInput(level, 0))
    expect(t.error).toBeNull()
    expect(t.energy).toBe(3) // only the move onto slime
    const out = t.steps.map(s => s.o ?? '').join('')
    expect(out).toBe('0\n1\n')
    const changes = t.steps.flatMap(s => s.mk ?? [])
    expect(changes).toEqual([[1, 1, null, '0'], [2, 1, null, '1'], [3, 1, null, '2'], [4, 1, null, '3'], [2, 1, '1', null]])
    // every mark_at sits on its own loop-line step: the wave grows line by line
    expect(t.steps.filter(s => s.mk).length).toBe(5)
    const w = level.variants[0]
    const marks = new Array<string | null>(w.cells.length).fill(null)
    seekMarks(marks, w.cols, t.steps, 0, t.steps.length)
    expect([marks[w.cols + 1], marks[w.cols + 2], marks[w.cols + 4]]).toEqual(['0', null, '3'])
    seekMarks(marks, w.cols, t.steps, t.steps.length, 0)
    expect(marks.every(m => m === null)).toBe(true)
    expect(t.steps.find(s => s.s?.some(([n]) => n === 'marked'))?.s).toEqual([['marked', '0']])
  })

  it('mark rejects long labels and cells outside the ship', () => {
    expect(run('mark(1000)\n', karaRunInput(level, 0)).error?.message).toMatch(/^ValueError: A mark has at most 3 characters/)
    expect(run('mark_at(7, 0, 1)\n', karaRunInput(level, 0)).error?.message).toMatch(/^IndexError: mark_at\(7, 0\)/)
    expect(run('mark_at(1.5, 0, 1)\n', karaRunInput(level, 0)).error?.sub).toBe('type')
  })

  it('a music switch bridges the acid (scan bruecke, ship_map g); a plain switch does not', () => {
    const music = parseKaraLevel(`
#######
#>m~~E#
#######
---
goal: exit`)
    const ok = run('move()\npress_switch()\nprint(scan())\nprint(ship_map()[1])\nfor i in range(3):\n    move()\n', karaRunInput(music, 0))
    expect(ok.error).toBeNull()
    expect(ok.goal?.reached).toBe(true)
    const out = ok.steps.map(s => s.o ?? '').join('').split('\n')
    expect(out[0]).toBe("['bruecke', 'bruecke', 'ausgang']")
    expect(out[1]).toBe('#.mggE#')
    expect(run('move()\nmove()\nmove()\n', karaRunInput(music, 0)).error?.sub).toBe('acid')
    // pressed twice: acid again
    expect(run('move()\npress_switch()\npress_switch()\nmove()\n', karaRunInput(music, 0)).error?.sub).toBe('acid')
    const plain = parseKaraLevel('#####\n#>S~E#\n#####')
    expect(run('move()\npress_switch()\nmove()\n', karaRunInput(plain, 0)).error?.sub).toBe('acid')
    // 'g' starts bridged
    const pre = parseKaraLevel('#####\n#>gE#\n#####\n---\ngoal: exit')
    expect(run('move()\nmove()\n', karaRunInput(pre, 0)).goal?.reached).toBe(true)
  })

  describe('callstack: on', () => {
    beforeAll(() => fs.writeFileSync(path.join(dir, 'befehle.py'), BEFEHLE))
    const cs = (code: string) => {
      const level = parseKaraLevel('#########\n#>......#\n#.......#\n#########\n---\ncallstack: on')
      return run(code, karaRunInput(level, 0))
    }

    it('records one frame per recursive call with its arguments, and pops on return', () => {
      const t = cs('def treppe(n):\n    if n == 0:\n        return\n    move()\n    treppe(n - 1)\n\ntreppe(3)\nmove()\n')
      expect(t.error).toBeNull()
      const stacks = buildCallStacks(t.steps)
      const at = (line: number) => t.steps.map((s, i) => [s, stacks[i + 1]] as const).filter(([s]) => s.l === line).map(([, st]) => st.top)
      expect(at(2)).toEqual([
        ['treppe(n=3)'],
        ['treppe(n=3)', 'treppe(n=2)'],
        ['treppe(n=3)', 'treppe(n=2)', 'treppe(n=1)'],
        ['treppe(n=3)', 'treppe(n=2)', 'treppe(n=1)', 'treppe(n=0)'],
      ])
      // Deltas only: a push keeps the caller's frames, the step after the return keeps none.
      expect(t.steps.filter(s => s.cs).map(s => s.cs![0])).toEqual([0, 1, 2, 3, 0])
      expect(stacks.at(-1)).toEqual({ depth: 0, top: [] })
      // d is the stack length
      t.steps.forEach((s, i) => expect(s.d ?? 0).toBe(stacks[i + 1].depth))
    })

    it('helper frames (befehle.py) and long argument reprs, cut to 20 chars', () => {
      const t = cs('from befehle import *\n\ndef los(liste, *rest, schritt=1):\n    drei_vor()\n\nlos(list(range(100)), "abcdefghijklmnopqrstuvwxyz", schritt=2)\n')
      const stacks = buildCallStacks(t.steps)
      const deepest = stacks.reduce((a, b) => (b.depth > a.depth ? b : a))
      expect(deepest.top[1]).toBe('drei_vor()')
      const [label] = deepest.top
      expect(label.startsWith('los(liste=[0, 1, 2, ...], schritt=2, rest=')).toBe(true)
      for (const arg of label.slice(4, -1).split(/, (?=\w+=)/)) expect(arg.split('=').slice(1).join('=').length).toBeLessThanOrEqual(20)
    })

    it('RecursionError: the last step holds the deep stack', () => {
      const t = cs('def f(n):\n    f(n + 1)\n\nf(0)\n')
      expect(t.error?.sub).toBe('recursion')
      const stacks = buildCallStacks(t.steps, 12)
      const last = stacks.at(-1)!
      expect(last.depth).toBeGreaterThan(100)
      expect(last.top).toHaveLength(12)
      expect(stacks[0]).toEqual({ depth: 0, top: [] })
    })

    it('without callstack: no cs on any step', () => {
      const t = run('def rec(n):\n    if n > 0:\n        rec(n - 1)\n\nrec(3)\n')
      expect(t.steps.some(s => s.cs)).toBe(false)
    })
  })
})
