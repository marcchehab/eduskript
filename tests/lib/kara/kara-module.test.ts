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
import { parseKaraWorld, buildReplay, type KaraTrace } from '@/lib/kara/world'

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

function run(code: string): KaraTrace {
  fs.writeFileSync(path.join(dir, '__kara_world.json'), JSON.stringify({ ...world, goals: [] }))
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
})
