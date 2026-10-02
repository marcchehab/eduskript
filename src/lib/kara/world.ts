/**
 * Kara world: level text ⇄ data model, plus the run trace the Python module
 * returns. The simulation itself runs in Python inside the Pyodide worker
 * (see kara-module.ts); this file parses the author's `kara-world` block and
 * replays the recorded trace on the main thread.
 *
 * Block layout:
 *
 *   <grid>                 one or more grids; separate variants with a line `===`
 *   ===                    (each Run picks one variant at random)
 *   <grid>
 *   ---                    optional config after `---`, one `key: value` per line
 *   goal: exit, collect
 *   energy: 30
 *
 * Grid legend (one char per cell, rows padded with floor):
 *   .  or space   floor                 s   slime trail (decoration)
 *   #             wall (autotiled)      x T P L R Y  crate / table / desk (PC) /
 *                                                    locker / red / yellow barrel —
 *                                                    obstacles, block like walls
 *   *             green barrel (item: Kara can stand on it, put and remove it)
 *   B  or M       box (pushable)        o   box target (floor marking)
 *   O             box on a target       c   evidence chip (picked up by walking over it)
 *   D             closed door           d   open door
 *   =  or |       laser (on)            S   switch: press_switch() toggles ALL doors and lasers
 *   ~             acid (Kara falls in)  E   exit
 *   t             terminal (blocks; read_log() while facing it)
 *   > < ^ v       Kara, facing east / west / north / south
 *
 * Config keys (values: positional fields separated by `|`, then optional
 * `key=value` fields):
 *   goal: exit, collect, boxes, chips, logs   all listed goals must hold at the end
 *                                         (logs = every terminal read via read_log())
 *   output: 7                             goal: the last printed line must equal this
 *   energy: N / memory: N                 limits for the 2nd/3rd star
 *   id: level-id                          key for saved progress (default: editor id)
 *   log: text | speaker=WEBER | audio=f.mp3        one per terminal, in reading order
 *   chip: id | title | text | speaker=… | audio=…  one per chip, in reading order
 *   intro: text | speaker=BRANDT | audio=f.mp3     repeatable; the level briefing,
 *                                         shown as a card above the code editor
 *                                         (several lines = a short dialogue, in order;
 *                                         speaker defaults to AURORA). Collapses to one
 *                                         line once the level is solved.
 *   aurora.<event>: text | audio=…        events: start, win, fail, error, loop
 *                                         (start = idle line in the bar under the world)
 *   aurora.error.<sub>: text              per error class, sub = wall, terminal, door,
 *                                         laser, box, acid, item, no_item, no_switch,
 *                                         no_terminal, name, module, indent, syntax,
 *                                         type, recursion, forbidden. Lookup: error.<sub> → error →
 *                                         course default (aurora-defaults.ts auroraLine)
 *   aurora.lint.<code>: text              AURORA's comment on a static finding when the run
 *                                         does not win; code = bare_call, never_called,
 *                                         sensor_no_call, no_return. {line} and {name} are
 *                                         replaced (also in aurora.error.forbidden: {name})
 *   aurora.fail.3: text                   replaces aurora.fail from the 3rd failed run
 *                                         in a row (per page view, see kara-panel.tsx)
 *   music: file.mp3                       ambient loop (off until the student turns it on)
 *
 * The world is a torus like the original Kara: walking off one edge enters on
 * the opposite side. Close levels with `#`.
 */

import type { KaraErrorSub, KaraLintCode } from './aurora-defaults'

// Cell flags. Keep in sync with kara-module.ts.
export const BLOCK = 1
export const ITEM = 2
export const BOX = 4
export const CHIP = 8
export const DOOR = 16 // closed
export const LASER = 32 // on
export const ACID = 64
export const EXIT = 128
export const SWITCH = 256
export const TARGET = 512
export const TERMINAL = 1024

/** 0 = north, 1 = east, 2 = south, 3 = west (clockwise, matches the Python module). */
export type KaraDir = 0 | 1 | 2 | 3

export interface KaraPos {
  x: number
  y: number
  d: KaraDir
}

export interface KaraWorld {
  cols: number
  rows: number
  /** Row-major bit flags (see above). */
  cells: number[]
  /** Row-major legend char per cell, for drawing only (never changes). */
  look: string[]
  kara: KaraPos
  /** Terminal / chip cells in reading order ([x, y]); index = log / chip number. */
  terminals: [number, number][]
  chips: [number, number][]
}

export interface KaraMessage {
  text: string
  speaker?: string
  audio?: string
}

export interface KaraEvidence extends KaraMessage {
  id: string
  title: string
}

export type KaraGoal = 'exit' | 'collect' | 'boxes' | 'chips' | 'logs' | 'output'

export interface KaraConfig {
  id?: string
  goals: KaraGoal[]
  /** Expected last printed line (goal 'output'). */
  output?: string
  energy?: number
  memory?: number
  /** Level briefing above the editor, in order (speaker always set, default AURORA). */
  intro: KaraMessage[]
  logs: KaraMessage[]
  chips: KaraEvidence[]
  aurora: Record<string, KaraMessage>
  music?: string
}

export interface KaraLevel {
  variants: KaraWorld[]
  config: KaraConfig
}

const DIR_CHARS: Record<string, KaraDir> = { '^': 0, '>': 1, 'v': 2, '<': 3 }
const OBSTACLES = new Set(['#', 'x', 'T', 'P', 'L', 'R', 'Y'])
const GOALS = new Set<KaraGoal>(['exit', 'collect', 'boxes', 'chips', 'logs', 'output'])

/** Legend char → [flags, look]. Kara chars and unknown chars are floor. */
function cellFor(ch: string): [number, string] {
  if (OBSTACLES.has(ch)) return [BLOCK, ch]
  switch (ch) {
    case '*': return [ITEM, '.']
    case 'B': case 'M': return [BOX, '.']
    case 'o': return [TARGET, 'o']
    case 'O': return [BOX | TARGET, 'o']
    case 'c': return [CHIP, '.']
    case 'D': return [DOOR, 'D']
    case 'd': return [0, 'D']
    case '=': case '|': return [LASER, ch]
    case '~': return [ACID, '~']
    case 'E': return [EXIT, 'E']
    case 'S': return [SWITCH, 'S']
    case 't': return [BLOCK | TERMINAL, 't']
    case 's': return [0, 's']
    default: return [0, '.']
  }
}

export function parseKaraWorld(src: string): KaraWorld {
  // Drop leading/trailing blank lines but keep inner ones (they are empty rows).
  const lines = src.replace(/\r/g, '').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const rows = Math.max(1, lines.length)
  const cols = Math.max(1, ...lines.map(l => l.replace(/\s+$/, '').length))
  const cells = new Array<number>(cols * rows).fill(0)
  const look = new Array<string>(cols * rows).fill('.')
  const terminals: [number, number][] = []
  const chips: [number, number][] = []
  let kara: KaraPos | null = null

  lines.forEach((line, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = line[x] ?? '.'
      const i = y * cols + x
      ;[cells[i], look[i]] = cellFor(ch)
      if (cells[i] & TERMINAL) terminals.push([x, y])
      if (cells[i] & CHIP) chips.push([x, y])
      if (ch in DIR_CHARS && !kara) kara = { x, y, d: DIR_CHARS[ch] }
    }
  })

  // No Kara in the grid: first free cell, facing east.
  if (!kara) {
    const free = cells.findIndex(c => c === 0)
    const i = free === -1 ? 0 : free
    kara = { x: i % cols, y: Math.floor(i / cols), d: 1 }
  }

  return { cols, rows, cells, look, kara, terminals, chips }
}

/** `a | b | key=value` → positional fields + named fields. */
function splitFields(value: string): { pos: string[]; named: Record<string, string> } {
  const pos: string[] = []
  const named: Record<string, string> = {}
  for (const raw of value.split('|')) {
    const f = raw.trim()
    const m = f.match(/^([a-z]+)=(.*)$/)
    if (m) named[m[1]] = m[2].trim()
    else pos.push(f)
  }
  return { pos, named }
}

function message(value: string): KaraMessage {
  const { pos, named } = splitFields(value)
  return { text: pos.join(' | '), speaker: named.speaker, audio: named.audio }
}

function evidence(value: string): KaraEvidence {
  const { pos, named } = splitFields(value)
  return { id: pos[0] ?? '', title: pos[1] ?? pos[0] ?? '', text: pos.slice(2).join(' | '), speaker: named.speaker, audio: named.audio }
}

export function parseKaraConfig(src: string): KaraConfig {
  const config: KaraConfig = { goals: [], intro: [], logs: [], chips: [], aurora: {} }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const m = raw.match(/^\s*([a-z][a-z0-9._]*)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'goal') config.goals = value.split(',').map(s => s.trim()).filter((g): g is KaraGoal => GOALS.has(g as KaraGoal))
    else if (key === 'energy' || key === 'memory') { const n = parseInt(value, 10); if (n > 0) config[key] = n }
    else if (key === 'output') config.output = value
    else if (key === 'id') config.id = value
    else if (key === 'music') config.music = value
    else if (key === 'intro') { const msg = message(value); config.intro.push({ ...msg, speaker: msg.speaker || 'AURORA' }) }
    else if (key === 'log') config.logs.push(message(value))
    else if (key === 'chip') config.chips.push(evidence(value))
    else if (key.startsWith('aurora.')) config.aurora[key.slice(7)] = { ...message(value), speaker: 'AURORA' }
  }
  if (config.output !== undefined && !config.goals.includes('output')) config.goals.push('output')
  return config
}

export function parseKaraLevel(src: string): KaraLevel {
  const text = src.replace(/\r/g, '')
  const sep = text.search(/^---\s*$/m)
  const grids = sep === -1 ? text : text.slice(0, sep)
  const config = sep === -1 ? '' : text.slice(sep).replace(/^---\s*$/m, '')
  const variants = grids.split(/^===\s*$/m).filter(g => g.trim()).map(parseKaraWorld)
  return { variants: variants.length ? variants : [parseKaraWorld('')], config: parseKaraConfig(config) }
}

/** Every spoken line of a level: intro, logs, chips and AURORA events. */
export function karaMessages(level: KaraLevel): KaraMessage[] {
  const { config } = level
  return [...config.intro, ...config.logs, ...config.chips, ...Object.values(config.aurora)]
}

/** Asset file names a level references (audio, music), for resolving to URLs. */
export function karaAssetNames(level: KaraLevel): string[] {
  const { config } = level
  const msgs = karaMessages(level)
  const names = msgs.map(m => m.audio).filter((a): a is string => !!a)
  if (config.music) names.push(config.music)
  return [...new Set(names)]
}

/** Every speaker a level shows a portrait for (lower-case). */
export function karaSpeakers(level: KaraLevel): string[] {
  const msgs = karaMessages(level)
  return [...new Set(['aurora', ...msgs.map(m => m.speaker?.toLowerCase()).filter((s): s is string => !!s)])]
}

// ─── Trace (produced by kara-module.ts `_run`) ───────────────────────────

/** [x, y, before, after] — one cell change. */
export type KaraMutation = [number, number, number, number]

/** ['log', terminal index] | ['chip', chip index] */
export type KaraEvent = ['log' | 'chip', number]

export interface KaraStep {
  /** Student-code line that was executed in this step (1-based). */
  l: number
  /** Kara after the step; omitted when unchanged. */
  k?: [number, number, number]
  /** Cell changes made during the step. */
  m?: KaraMutation[]
  /** Sensor calls during the step: [name, result]. */
  s?: [string, boolean][]
  /** Printed text during the step. */
  o?: string
  /** Story events during the step. */
  v?: KaraEvent[]
  /**
   * 1-based index of this step's action among the actions of one execution
   * of line `l`; only set when that execution made more than one action
   * (e.g. `drei_vor()` → steps with sub 1, 2, 3 on the call line).
   */
  sub?: number
  /** Helper module the action ran in (e.g. 'befehle.py'); absent for the student's own file. */
  f?: string
  /** Line in `f`. */
  fl?: number
  /** Function in `f` the action ran in ('<module>' at import time). */
  fn?: string
}

/** One static finding; AURORA comments on it with `lint.<code>` (aurora-defaults.ts). */
export interface KaraLint {
  line: number
  code: KaraLintCode
  /** The command / sensor / function the finding is about. */
  name: string
}

export interface KaraTrace {
  steps: KaraStep[]
  error: {
    line: number | null
    message: string
    kind?: 'loop' | 'kara' | 'python'
    /** Error class for AURORA's comment (null/absent: unclassified, e.g. ValueError). */
    sub?: KaraErrorSub | null
    /** Forbidden name (sub 'forbidden'), e.g. 'exec'; missing module (sub 'module'), e.g. 'befehle'. */
    name?: string
  } | null
  /** Static checks of the student's code (kara-module.ts `_lint`), sorted by line. */
  lints?: KaraLint[]
  /** Level result; absent when the program raised. */
  goal?: { reached: boolean; missing: KaraGoal[] }
  /** Actions performed (moves, turns, put/remove, press, read). */
  energy: number
  /** Statements in the student's program (Python AST). */
  memory: number
}

/** Stars: 1 = goal reached, +1 memory within limit, +1 energy within limit (no limit = star). */
export function karaStars(trace: KaraTrace, config: KaraConfig): number {
  if (trace.error || !trace.goal?.reached) return 0
  let stars = 1
  if (!config.memory || trace.memory <= config.memory) stars++
  if (!config.energy || trace.energy <= config.energy) stars++
  return stars
}

/**
 * Precomputed replay data. Kara positions are filled forward so any step can
 * be shown in O(1); cell state is moved incrementally by applying/undoing the
 * mutations between two positions (O(|Δsteps|), fine for the 50k-step cap).
 */
export interface KaraReplay {
  /** Number of steps. Positions run 0..length (0 = initial world). */
  length: number
  /** kara[p] = Kara after p steps. */
  kara: KaraPos[]
  /** All printed text; outputEnd[p] = its length after p steps. */
  output: string
  outputEnd: number[]
  /** subTotal[i] = number of steps in step i's `sub` run (0 when step i has no `sub`). */
  subTotal: number[]
}

export function buildReplay(world: KaraWorld, trace: KaraTrace): KaraReplay {
  const kara: KaraPos[] = [world.kara]
  const outputEnd: number[] = [0]
  let output = ''
  let cur = world.kara
  for (const step of trace.steps) {
    if (step.k) cur = { x: step.k[0], y: step.k[1], d: step.k[2] as KaraDir }
    kara.push(cur)
    if (step.o) output += step.o
    outputEnd.push(output.length)
  }
  const steps = trace.steps
  const subTotal: number[] = new Array(steps.length).fill(0)
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i], next = steps[i + 1]
    if (!s.sub) continue
    subTotal[i] = next && next.l === s.l && next.sub === s.sub + 1 ? subTotal[i + 1] : s.sub
  }
  return { length: steps.length, kara, output, outputEnd, subTotal }
}

/** Mutate `cells` from the state after `from` steps to the state after `to` steps. */
export function seekCells(cells: number[], cols: number, steps: KaraStep[], from: number, to: number): void {
  if (to > from) {
    for (let i = from; i < to; i++) {
      for (const [x, y, , after] of steps[i].m ?? []) cells[y * cols + x] = after
    }
  } else {
    for (let i = from - 1; i >= to; i--) {
      const m = steps[i].m ?? []
      for (let j = m.length - 1; j >= 0; j--) {
        const [x, y, before] = m[j]
        cells[y * cols + x] = before
      }
    }
  }
}
