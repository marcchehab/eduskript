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
import { parseKaraWorld, parseKaraLevel, buildReplay, karaRunInput, karaStars, karaSuiteStars, type KaraTrace } from '@/lib/kara/world'

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
    expect(lints('def f():\n    f()\n')).toEqual([[1, 'never_called', 'f']])
    expect(lints('def a():\n    move()\ndef b():\n    a()\nb()\n')).toEqual([])
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
