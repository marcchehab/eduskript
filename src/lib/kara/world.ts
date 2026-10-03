/**
 * Kara world: level text ⇄ data model, plus the run trace the Python module
 * returns. The simulation itself runs in Python inside the Pyodide worker
 * (see kara-module.ts); this file parses the author's `kara-world` block and
 * replays the recorded trace on the main thread.
 *
 * Block layout:
 *
 *   <grid>                 one or more grids; separate variants with a line `===`
 *   ===                    (the panel picks one with ‹ › for Run; «Test all worlds»
 *                          runs every variant, and stars count only then, as the
 *                          minimum over all variants — see kara-panel.tsx)
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
 *   q             broken box target: drawn and scored like `o`, but on_target()
 *                 is always False there (week 5 aftermath)
 *   a             open airlock: a box pushed onto it is gone (sucked out); Kara
 *                 itself can drive over it like floor
 *   m             music switch: press_switch() there toggles every `~` cell
 *                 between acid and a walkable slime bridge (Gerald); doors and
 *                 lasers stay. A plain `S` never touches acid.
 *   g             acid that starts bridged (walkable; `m` turns it back into acid)
 *   > < ^ v       Kara, facing east / west / north / south
 *
 * Config keys (values: positional fields separated by `|`, then optional
 * `key=value` fields):
 *   goal: exit, collect, boxes, chips, logs   all listed goals must hold at the end
 *                                         (logs = every terminal read via read_log())
 *   output: 7                             goal: the last printed line must equal this
 *   output: 10 | 7 | 13                   per variant, by index (one value = every variant;
 *                                         a variant without a value can never meet the goal)
 *   door.ask: zaehle_faesser = 4 | 2 | 7   door code: a move() into a closed door first calls
 *                                         the student's zaehle_faesser() (no arguments, traced,
 *                                         costs energy); the door opens when the answer matches
 *                                         this variant's value (by index like output; True/False
 *                                         must be a bool, anything else compares as str()).
 *                                         Wrong answer: error sub door_code; no such function:
 *                                         door_missing. Repeatable: the i-th door in reading order
 *                                         asks the i-th line (the last line covers the rest).
 *                                         Every door of the level asks, also switch-closed ones.
 *   energy: N / memory: N                 limits for the 2nd/3rd star
 *   looks: N                              limit of look_at() calls; the energy star needs
 *                                         both energy and looks within their limits
 *   costs: s=3, o=2                       field costs: a move() ending on a cell with this
 *                                         legend char (static look: s, o, a, ~, E, S, m, …)
 *                                         costs N energy instead of 1; turns stay 1
 *   data: postfach = ["a", "b"] | ["c"]  global variable for the student's code, per variant
 *                                         by index like output (one value = every variant).
 *                                         Value: JSON or a Python literal (('x', 1), 'a', True),
 *                                         or `@name.json` = a skript file with JSON in it.
 *                                         `|` inside quotes/brackets does not split. Repeatable
 *                                         (one line per variable). A variant without a value or
 *                                         a missing file stops the run with a ValueError.
 *   id: level-id                          key for saved progress (default: editor id)
 *   log: text | speaker=WEBER | audio=f.mp3        one per terminal, in reading order
 *   chip: id | title | text | speaker=… | audio=…  one per chip, in reading order
 *   intro: text | speaker=BRANDT | audio=f.mp3     repeatable; the level briefing,
 *                                         shown as a card above the code editor
 *                                         (several lines = a short dialogue, in order;
 *                                         speaker defaults to AURORA). Collapses to one
 *                                         line once the level is solved.
 *   aurora.<event>: text | audio=…        events: start, win, fail, error, loop, door.ok
 *                                         (door.ok = card when a door code was right; no default)
 *                                         (start = idle line in the bar under the world)
 *   aurora.error.<sub>: text              per error class, sub = wall, terminal, door,
 *                                         laser, box, acid, item, no_item, no_switch,
 *                                         no_terminal, door_code, door_missing, name, module,
 *                                         indent, syntax, type, recursion, forbidden, tamper
 *                                         (attribute starting with _, e.g. kara._w), locked
 *                                         (a loop the level forbids), toolbox_syntax / toolbox_indent
 *                                         (that error inside befehle.py; the editor opens its tab),
 *                                         toolbox_name (NameError raised inside befehle.py; same).
 *                                         Lookup: error.<sub> → error →
 *                                         course default (aurora-defaults.ts auroraLine)
 *   aurora.lint.<code>: text              AURORA's comment on a static finding when the run
 *                                         does not win; code = bare_call, never_called,
 *                                         sensor_no_call, no_return, indented_call (main program
 *                                         indented into the last def; {name} = that def), toolbox_call
 *                                         (a call outside any def in befehle.py ran on import; {name} =
 *                                         'befehle.py:<line>', {line} = the import line; the run never wins),
 *                                         toolbox_bare (move without () in befehle.py; {name} = move).
 *                                         {line} and {name} are
 *                                         replaced (also in aurora.error.forbidden: {name};
 *                                         error.door_code: {name} {got} {want}; door_missing: {name})
 *   aurora.fail.3: text                   replaces aurora.fail from the 3rd failed run
 *                                         in a row (per page view, see kara-panel.tsx)
 *   aurora.fail.<goal>: text              replaces aurora.fail when <goal> is the FIRST missing
 *                                         goal (order: exit, collect, boxes, chips, logs, output),
 *                                         so fail.logs may assume Kara is at the exit; the
 *                                         goal list always shows below
 *   aurora.win.memory / aurora.win.energy replaces aurora.win when the run reached the goal
 *                                         but went over that limit (a star short)
 *   forbid: for, while                    refuse runs using these loops (error sub locked,
 *                                         {name} = the keyword); e.g. week 1 before for exists
 *   music: file.mp3                       ambient loop (off until the student turns it on)
 *   generate: <kind> key=value …          repeatable; appends generated variants after the
 *                                         hand-drawn grids (generate.ts). Ranges `a..b` or `a`:
 *     corridor len=5..14 items=0..3 count=6   1-row corridor, Kara west facing east, exit at
 *                                         the east end, `items` green barrels in between
 *     room w=3..7 h=2..5 slime=all count=5    closed w×h room, Kara top-left facing east,
 *                                         barrels on every cell (slime=all) or each with p (slime=0.3)
 *     maze w=9 h=9 loops=0 count=6        perfect DFS maze (odd size), Kara (1,1) facing east,
 *                                         exit at the farthest dead end; loops=k removes k walls
 *                                         and puts the exit where no wall follower ever comes
 *     stairs steps=3..8 count=4           staircase down to the south-east (move, n × stufe, move)
 *                                         `seed=…` fixes the seed; default seed = level id
 *                                         (else the spec line). Same text → same worlds.
 *   under: E                              the cell under Kara's start is this legend char in every
 *                                         world (Kara starts on the exit, a switch, slime …); not for
 *                                         blocking chars, terminals or chips
 *   place: c far                          in every generated world, put `c` (legend char) on the
 *                                         reachable cell farthest from Kara (BFS)
 *   aftermath: <generate spec>            hidden world the panel runs the student's program on once
 *     or a grid after a line `=== aftermath` more after a win (all worlds); never counts for stars.
 *                                         The grid wins over the spec (spec: the first generated world).
 *   aftermath.text: text | speaker=…      card before the aftermath plays (default: AURORA's
 *                                         «Ich habe Ihr Programm kurz in der Schleuse getestet. Nur kurz.»)
 *   aftermath.end: text                   card when the aftermath replay ends (default: the
 *                                         normal result line, e.g. aurora.loop on the step limit)
 *   aftermath.steps: N                    step limit for the aftermath run (default 300, so a
 *                                         loop ends after a few seconds of replay)
 *   archive: true                         save the student's code on a win (progress.ts), shown
 *                                         later by <kara-archive of="<level id>">
 *   debug: into                           replay starts in «Step into» mode: the editor follows
 *                                         actions into helper files (befehle.py); default `over`
 *                                         (marker stays on the call). The toggle is always there.
 *   callstack: on                         recursion week: every step records the call stack
 *                                         (KaraStep.cs); the panel draws it as stacked retro
 *                                         dialog windows over the world's top-right corner
 *                                         ('treppe(n=3)' …, newest on top, Büroklämmerli on the
 *                                         top one, at most 12 + '+ N more'); a RecursionError
 *                                         floods the world with windows before AURORA's line.
 *
 * The world is a torus like the original Kara: walking off one edge enters on
 * the opposite side. Close levels with `#`.
 */

import type { KaraErrorSub, KaraLintCode } from './aurora-defaults'
import { generateWorlds, placeFar } from './generate'

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
/** With TARGET: on_target() is always False here ('q'). */
export const BROKEN = 2048
/** Open airlock ('a'): boxes pushed onto it vanish. */
export const AIRLOCK = 4096

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
  /**
   * Expected last printed line (goal 'output'), per variant index. One value
   * applies to every variant; see karaOutput.
   */
  output?: string[]
  /** `door.ask:` lines in order: function name + expected answer per variant (see karaDoorAsk). */
  doorAsk: { fn: string; expected: string[] }[]
  energy?: number
  memory?: number
  /** `looks:` limit of look_at() calls (part of the energy star, see karaStars). */
  looks?: number
  /** `costs: s=3` — energy of a move() onto a cell by its look char (kara-module.ts move). */
  costs?: Record<string, number>
  /** `data:` lines: a global per line, raw value text per variant (see karaData). */
  data: { name: string; values: string[] }[]
  /** Level briefing above the editor, in order (speaker always set, default AURORA). */
  intro: KaraMessage[]
  logs: KaraMessage[]
  chips: KaraEvidence[]
  aurora: Record<string, KaraMessage>
  music?: string
  /** `generate:` lines (generate.ts), in order; their worlds follow the hand-drawn ones. */
  generate: string[]
  /** `place: c far` — legend char put at the farthest reachable cell of every generated world. */
  place?: string
  /** `under: E` — legend char of the cell under Kara's start in every world (e.g. start on the exit). */
  under?: string
  /** `aftermath:` generate spec (the `=== aftermath` grid wins, see parseKaraLevel). */
  aftermath?: string
  /** `aftermath.text:` / `aftermath.end:` cards (speaker default AURORA). */
  aftermathText?: KaraMessage
  aftermathEnd?: KaraMessage
  /** `aftermath.steps:` step limit of the aftermath run. */
  aftermathSteps?: number
  /** `archive: true` — save the winning code (progress.ts, <kara-archive>). */
  archive?: boolean
  /** `debug: into` — the replay starts in «Step into» mode (kara-panel.tsx); absent = step over. */
  debug?: 'into' | 'over'
  /** `callstack: on` — record the call stack per step (KaraStep.cs) and show it (kara-callstack.tsx). */
  callstack?: boolean
  /** `forbid: for, while` — refuse runs that use these loops (kara-module.ts `_lint`, error sub 'locked'). */
  forbid?: ('for' | 'while')[]
}

export interface KaraLevel {
  variants: KaraWorld[]
  config: KaraConfig
  /** Hidden world for the after-win replay (`aftermath:`); never a variant. */
  aftermath?: KaraWorld
}

export const AFTERMATH_TEXT = 'Ich habe Ihr Programm kurz in der Schleuse getestet. Nur kurz.'
export const AFTERMATH_STEPS = 300

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
    case 'q': return [TARGET | BROKEN, 'q']
    case 'a': return [AIRLOCK, 'a']
    case 'O': return [BOX | TARGET, 'o']
    case 'c': return [CHIP, '.']
    case 'D': return [DOOR, 'D']
    case 'd': return [0, 'D']
    case '=': case '|': return [LASER, ch]
    case '~': return [ACID, '~']
    case 'g': return [0, '~']
    case 'm': return [SWITCH, 'm']
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

/**
 * Split on `|` outside quotes and brackets (`["a|b"] | [1]` → 2 parts), for
 * `data:` values. O(length). Unbalanced brackets just keep everything after
 * them in one part.
 */
export function splitData(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if ('[({'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    else if (ch === '|' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(value.slice(start).trim())
  return parts
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
  const config: KaraConfig = { goals: [], doorAsk: [], data: [], intro: [], logs: [], chips: [], aurora: {}, generate: [] }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const m = raw.match(/^\s*([a-z][a-z0-9._]*)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'goal') config.goals = value.split(',').map(s => s.trim()).filter((g): g is KaraGoal => GOALS.has(g as KaraGoal))
    else if (key === 'energy' || key === 'memory' || key === 'looks') { const n = parseInt(value, 10); if (n > 0) config[key] = n }
    else if (key === 'data') {
      const m = value.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/)
      if (m) config.data.push({ name: m[1], values: splitData(m[2]) })
    }
    else if (key === 'costs') {
      const costs: Record<string, number> = {}
      for (const m of value.matchAll(/(\S)\s*=\s*(\d+)/g)) costs[m[1]] = parseInt(m[2], 10)
      if (Object.keys(costs).length) config.costs = costs
    }
    else if (key === 'output') config.output = value.split('|').map(s => s.trim())
    else if (key === 'id') config.id = value
    else if (key === 'door.ask') {
      const m = value.match(/^([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*=\s*(.+)$/)
      if (m) config.doorAsk.push({ fn: m[1], expected: m[2].split('|').map(s => s.trim()) })
    }
    else if (key === 'music') config.music = value
    else if (key === 'generate') config.generate.push(value)
    else if (key === 'place') { const m = value.match(/^(\S)\s+far$/); if (m) config.place = m[1] }
    else if (key === 'under') { const m = value.match(/^(\S)$/); if (m) config.under = m[1] }
    else if (key === 'intro') { const msg = message(value); config.intro.push({ ...msg, speaker: msg.speaker || 'AURORA' }) }
    else if (key === 'log') config.logs.push(message(value))
    else if (key === 'chip') config.chips.push(evidence(value))
    else if (key === 'aftermath') config.aftermath = value
    else if (key === 'aftermath.text' || key === 'aftermath.end') {
      const msg = message(value)
      config[key === 'aftermath.text' ? 'aftermathText' : 'aftermathEnd'] = { ...msg, speaker: msg.speaker || 'AURORA' }
    }
    else if (key === 'aftermath.steps') { const n = parseInt(value, 10); if (n > 0) config.aftermathSteps = n }
    else if (key === 'archive') config.archive = /^(true|yes|1|on)$/i.test(value)
    else if (key === 'debug') { const v = value.toLowerCase(); if (v === 'into' || v === 'over') config.debug = v }
    else if (key === 'callstack') config.callstack = /^(true|yes|1|on)$/i.test(value)
    else if (key === 'forbid') {
      const kw = value.split(',').map(s => s.trim().toLowerCase()).filter((k): k is 'for' | 'while' => k === 'for' || k === 'while')
      if (kw.length) config.forbid = kw
    }
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
  // `=== aftermath`: everything after it (up to `---`) is the aftermath grid, not a variant.
  const am = grids.search(/^===\s*aftermath\s*$/m)
  const variantText = am === -1 ? grids : grids.slice(0, am)
  const aftermathText = am === -1 ? '' : grids.slice(am).replace(/^===\s*aftermath\s*$/m, '')
  const variants = variantText.split(/^===\s*$/m).filter(g => g.trim()).map(parseKaraWorld)
  const cfg = parseKaraConfig(config)
  for (const spec of cfg.generate) {
    for (const w of generateWorlds(spec, cfg.id ?? '')) {
      if (cfg.place) placeFar(w, cfg.place)
      variants.push(w)
    }
  }
  let aftermath: KaraWorld | undefined
  if (aftermathText.trim()) aftermath = parseKaraWorld(aftermathText)
  else if (cfg.aftermath) {
    aftermath = generateWorlds(cfg.aftermath, `${cfg.id ?? ''}-aftermath`)[0]
    if (aftermath && cfg.place) placeFar(aftermath, cfg.place)
  }
  if (cfg.under) for (const w of [...variants, ...(aftermath ? [aftermath] : [])]) putUnderKara(w, cfg.under)
  return { variants: variants.length ? variants : [parseKaraWorld('')], config: cfg, ...(aftermath ? { aftermath } : {}) }
}

/**
 * `under: E`: the cell under Kara's start becomes legend char `ch` (the grid
 * can only draw Kara on floor). Blocking chars, terminals and chips are
 * ignored: Kara cannot start inside a wall, and chips would shift the chip
 * order (reading order). O(1).
 */
function putUnderKara(world: KaraWorld, ch: string): void {
  const [flags, look] = cellFor(ch)
  if (flags & (BLOCK | TERMINAL | CHIP)) return
  const i = world.kara.y * world.cols + world.kara.x
  world.cells[i] = flags
  world.look[i] = look
}

/**
 * Expected output for variant `v`: one value = all variants, else by index.
 * undefined when the level has no output goal or no value for `v` (that
 * variant's output goal then fails, which check.ts reports).
 */
export function karaOutput(config: KaraConfig, v: number): string | undefined {
  const out = config.output
  if (!out) return undefined
  return out.length === 1 ? out[0] : out[v]
}

/**
 * Door codes for variant `v`: [function, expected] per `door.ask:` line.
 * One value = all variants, else by index; null when a line has no value for
 * `v` (that door can never open, check.ts then reports a door_code error).
 */
export function karaDoorAsk(config: KaraConfig, v: number): [string, string | null][] {
  return config.doorAsk.map(({ fn, expected }) => [fn, (expected.length === 1 ? expected[0] : expected[v]) ?? null])
}

/** Skript files the level's `data:` lines read (`@name.json`), without the @. */
export function karaDataFiles(config: KaraConfig): string[] {
  return [...new Set(config.data.flatMap(d => d.values).filter(t => t.startsWith('@')).map(t => t.slice(1).trim()))]
}

/**
 * `data:` values for variant `v`: [name, text] per line, text = the inline
 * value or the content of `@file` from `files` (file name → text). null when
 * the line has no value for `v` or the file is not in `files`; the Python
 * side then raises ValueError (kara-module.ts `_data_value`).
 */
export function karaData(config: KaraConfig, v: number, files: Record<string, string> = {}): [string, string | null][] {
  return config.data.map(({ name, values }) => {
    const raw = (values.length === 1 ? values[0] : values[v]) ?? null
    if (raw === null || !raw.startsWith('@')) return [name, raw]
    return [name, files[raw.slice(1).trim()] ?? null]
  })
}

export type KaraRunInput = KaraWorld & {
  goals: KaraGoal[]
  output?: string
  door_ask: [string, string | null][]
  data: [string, string | null][]
  costs?: Record<string, number>
  /** Record the call stack per step (`callstack: on`, kara-module.ts `_cs_update`). */
  callstack?: boolean
  /** Locked loop keywords (`forbid:`). */
  forbid?: ('for' | 'while')[]
}

/**
 * The JSON the Python `_run` reads (`__kara_world.json`) for variant `v`.
 * Used by the editor and check.ts. `files`: contents of the `@file` data
 * files (karaDataFiles), fetched by the caller.
 */
export function karaRunInput(level: KaraLevel, v: number, files?: Record<string, string>): KaraRunInput {
  return {
    ...level.variants[v],
    goals: level.config.goals,
    output: karaOutput(level.config, v),
    door_ask: karaDoorAsk(level.config, v),
    data: karaData(level.config, v, files),
    ...(level.config.costs ? { costs: level.config.costs } : {}),
    ...(level.config.callstack ? { callstack: true } : {}),
    ...(level.config.forbid ? { forbid: level.config.forbid } : {}),
  }
}

/**
 * Run input for the aftermath world (`aftermath:`): same goals, door
 * codes and data as variant 0, plus a low step limit (`max_steps`, kara-module.ts).
 * null when the level has none.
 */
export function karaAftermathInput(level: KaraLevel, files?: Record<string, string>): (KaraRunInput & { max_steps: number }) | null {
  if (!level.aftermath) return null
  return {
    ...level.aftermath,
    goals: level.config.goals,
    output: karaOutput(level.config, 0),
    door_ask: karaDoorAsk(level.config, 0),
    data: karaData(level.config, 0, files),
    ...(level.config.costs ? { costs: level.config.costs } : {}),
    ...(level.config.callstack ? { callstack: true } : {}),
    ...(level.config.forbid ? { forbid: level.config.forbid } : {}),
    max_steps: level.config.aftermathSteps ?? AFTERMATH_STEPS,
  }
}

/** Every spoken line of a level: intro, logs, chips, AURORA events and the aftermath cards. */
export function karaMessages(level: KaraLevel): KaraMessage[] {
  const { config } = level
  const aftermath = level.aftermath
    ? [config.aftermathText ?? { text: AFTERMATH_TEXT, speaker: 'AURORA' }, ...(config.aftermathEnd ? [config.aftermathEnd] : [])]
    : []
  return [...config.intro, ...config.logs, ...config.chips, ...Object.values(config.aurora), ...aftermath]
}

/** Asset file names a level references (audio, music, `data: x = @f.json`), for resolving to URLs. */
export function karaAssetNames(level: KaraLevel): string[] {
  const { config } = level
  const msgs = karaMessages(level)
  const names = msgs.map(m => m.audio).filter((a): a is string => !!a)
  if (config.music) names.push(config.music)
  names.push(...karaDataFiles(config))
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

/** [x, y, before, after] — one mark change; labels are ≤ 3 chars, null = unmarked. */
export type KaraMarkChange = [number, number, string | null, string | null]

/** ['log', terminal index] | ['chip', chip index] | ['door', door index] (door code accepted) */
export type KaraEvent = ['log' | 'chip' | 'door', number]

export interface KaraStep {
  /** Student-code line that was executed in this step (1-based). */
  l: number
  /** Kara after the step; omitted when unchanged. */
  k?: [number, number, number]
  /** Cell changes made during the step. */
  m?: KaraMutation[]
  /** Mark changes (mark / mark_at) during the step: [x, y, before, after], null = no mark. */
  mk?: KaraMarkChange[]
  /**
   * Sensor calls during the step: [name, result]. Bool sensors give the bool;
   * data sensors (scan, position, ship_map, look_at, marked) give repr(value), ≤ 80 chars.
   */
  s?: [string, boolean | string][]
  /** Door code asked on this step: [function, repr(answer), answer accepted]. */
  q?: [string, string, boolean]
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
  /** Call depth: user function frames (student file + helper modules) on the stack; absent = 0 (top level). */
  d?: number
  /**
   * Call stack change (only with `callstack: on`; absent = same stack as the
   * previous step): [keep, ...labels] = keep the first `keep` frames of the
   * previous step's stack, then push these ('treppe(n=2)', argument reprs
   * cut to 20 chars). Outermost first. Decode with buildCallStacks.
   */
  cs?: [number, ...string[]]
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
    /** Forbidden name (sub 'forbidden'), e.g. 'exec'; missing module (sub 'module'), e.g. 'befehle'; door function (door_code / door_missing). */
    name?: string
    /** Error inside a helper (sub toolbox_*): its file name, e.g. 'befehle.py', and line there. */
    f?: string
    fl?: number
    /** door_code: repr of the wrong answer, e.g. 'None' (cut to 40 chars). */
    got?: string
    /** door_code: what kind of answer the door expected. */
    want?: KaraDoorWant
  } | null
  /** Static checks of the student's code (kara-module.ts `_lint`), sorted by line. */
  lints?: KaraLint[]
  /** Level result; absent when the program raised. */
  goal?: { reached: boolean; missing: KaraGoal[] }
  /** Actions performed (moves, turns, put/remove, press, read). */
  energy: number
  /** Statements in the student's program (Python AST). */
  memory: number
  /** look_at() calls; absent when 0. */
  looks?: number
}

export type KaraDoorWant = 'bool' | 'number' | 'text'

/**
 * Stars: 1 = goal reached, +1 memory within limit, +1 energy AND looks within
 * their limits (no limit = within).
 */
export function karaStars(trace: KaraTrace, config: KaraConfig): number {
  if (trace.error || !trace.goal?.reached) return 0
  let stars = 1
  if (!config.memory || trace.memory <= config.memory) stars++
  if ((!config.energy || trace.energy <= config.energy) && (!config.looks || (trace.looks ?? 0) <= config.looks)) stars++
  return stars
}

/** Result detail line: 'Memory 5/6 · Energy 12/14' (+ ' · Looks 40/50' when the level counts looks). */
export function karaLimits(trace: KaraTrace, config: KaraConfig): string {
  const part = (label: string, n: number, max?: number) => (max ? `${label} ${n}/${max}` : `${label} ${n}`)
  const parts = [part('Memory', trace.memory, config.memory), part('Energy', trace.energy, config.energy)]
  if (config.looks || trace.looks) parts.push(part('Looks', trace.looks ?? 0, config.looks))
  return parts.join(' · ')
}

/**
 * Stars for a «Test all worlds» suite: the minimum over all variants (0 when
 * any variant is missing, errors or misses the goal).
 */
export function karaSuiteStars(traces: (KaraTrace | null)[], config: KaraConfig): number {
  if (!traces.length) return 0
  return Math.min(...traces.map(t => (t ? karaStars(t, config) : 0)))
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

/** Call stack after p steps, for the overlay: total depth and the newest `cap` frames (outermost first). */
export interface KaraCallStack {
  depth: number
  top: string[]
}

/**
 * Decodes the `cs` deltas: result[p] = stack after p steps ([0] = empty).
 * O(steps · cap) time and memory (only the newest `cap` labels are kept per
 * position; the full stack lives in one working array). Consecutive
 * positions with an unchanged stack share one object.
 */
export function buildCallStacks(steps: KaraStep[], cap = 12): KaraCallStack[] {
  const stack: string[] = []
  let cur: KaraCallStack = { depth: 0, top: [] }
  const out = [cur]
  for (const step of steps) {
    if (step.cs) {
      const [keep, ...push] = step.cs
      stack.length = Math.min(stack.length, keep)
      stack.push(...push)
      cur = { depth: stack.length, top: stack.slice(-cap) }
    }
    out.push(cur)
  }
  return out
}

/**
 * Same as seekCells for the marks (row-major labels, null = none). O(|Δsteps|).
 * Callers start from an all-null array: levels have no initial marks.
 */
export function seekMarks(marks: (string | null)[], cols: number, steps: KaraStep[], from: number, to: number): void {
  if (to > from) {
    for (let i = from; i < to; i++) {
      for (const [x, y, , after] of steps[i].mk ?? []) marks[y * cols + x] = after
    }
  } else {
    for (let i = from - 1; i >= to; i--) {
      const mk = steps[i].mk ?? []
      for (let j = mk.length - 1; j >= 0; j--) {
        const [x, y, before] = mk[j]
        marks[y * cols + x] = before
      }
    }
  }
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
