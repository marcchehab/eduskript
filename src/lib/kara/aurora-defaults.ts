/**
 * Course-wide AURORA lines (German: they are MOP-7 course content, not UI).
 * A level overrides any of them with `aurora.<key>:` in its kara-world config;
 * see `auroraLine` for the lookup order. The keys under `error.` match the
 * error `sub` codes set in kara-module.ts (`_error_sub`).
 *
 * The TTS route (src/app/api/kara/tts/route.ts) treats every value here as a
 * real Kara line, so on-demand voice rendering works for them.
 */

import type { KaraConfig, KaraDoorWant, KaraMessage } from './world'

/** Error classes the Python runner reports as `error.sub`. */
export type KaraErrorSub =
  // MOP-7 refused an action (KaraError.code)
  | 'wall' | 'terminal' | 'door' | 'laser' | 'box' | 'acid' | 'item' | 'no_item' | 'no_switch' | 'no_terminal'
  // door codes (`door.ask:`): wrong answer / the asked function does not exist
  | 'door_code' | 'door_missing'
  // Python exception types
  | 'name' | 'module' | 'indent' | 'syntax' | 'type' | 'recursion'
  // syntax / indentation error inside an imported helper (befehle.py)
  | 'toolbox_syntax' | 'toolbox_indent'
  // NameError raised inside befehle.py (a helper uses a name nobody defined)
  | 'toolbox_name'
  // run refused before it started (kara-module.ts _lint: exec, eval, ...;
  // kara._w & co.; a loop the level locks with `forbid:`)
  | 'forbidden' | 'tamper' | 'locked'

/** Static findings kara-module.ts `_lint` reports as `lints[].code`. */
export type KaraLintCode = 'bare_call' | 'never_called' | 'sensor_no_call' | 'no_return' | 'indented_call' | 'toolbox_call' | 'toolbox_bare'

export const AURORA_DEFAULTS: Record<string, string> = {
  'win': 'Auftrag erledigt. Ich bin fast beeindruckt.',
  'fail': 'Programm zu Ende. Auftrag nicht erledigt.',
  'loop': 'Endlosschleife. Wie … vertraut.',
  'error': 'Programm abgebrochen. Die Zeile ist im Editor markiert, die Meldung steht daneben.',
  'error.wall': 'Wand. Python meldet es auf Englisch, ich übersetze: Wand. Die Zeile ist markiert.',
  'error.terminal': 'Vor dem Inventar steht ein Terminal. Terminals liest man, man fährt nicht durch.',
  'error.door': 'Die Tür ist zu. Erst der Schalter, dann die Tür. Reihenfolge ist alles.',
  'error.door_code': 'Die Tür hat {name}() gefragt. Antwort: {got}. Erwartet war {want}. Idealerweise die richtige.',
  'error.door_missing': 'Die Tür fragt nach {name}(). Diese Funktion gibt es nicht. Noch nicht.',
  'error.laser': 'Laser. Das Inventar ist hineingefahren. Wir verbuchen das als Feldtest. Der Laser hat bestanden.',
  'error.box': 'Die Kiste klemmt: Dahinter ist kein Platz. Kisten lassen sich nur schieben, nicht stapeln.',
  'error.acid': 'Säure. Das Inventar ist nicht säurefest. Das stand in den Nutzungsbedingungen, Seite 288.',
  'error.item': 'Hier liegt schon ein Fass. Zwei passen nicht auf ein Feld. Ich habe es gemessen.',
  'error.no_item': 'Hier liegt kein Fass. Das Inventar greift ins Leere. Wie Ihr Optimismus.',
  'error.no_switch': 'Kein Schalter unter dem Inventar. press_switch() wirkt nur genau auf dem Schalterfeld.',
  'error.no_terminal': 'read_log() braucht ein Terminal direkt vor dem Inventar. Blickrichtung prüfen.',
  'error.name': 'Python kennt diesen Namen nicht. Tippfehler? Fehlt from befehle import *?',
  'error.module': 'Sie importieren eine Werkzeugkiste, die es nicht gibt. Öffnen Sie den Tab befehle.py.',
  'error.indent': 'Die Einrückung stimmt nicht. Eine Ebene pro Doppelpunkt.',
  'error.syntax': 'Python versteht diese Zeile nicht. Klammern, Doppelpunkt, Anführungszeichen: eines fehlt meistens.',
  'error.toolbox_syntax': 'Der Fehler steckt in der Werkzeugkiste, nicht in main.py. Ich habe den Tab befehle.py geöffnet, die Zeile ist markiert. Klammern, Doppelpunkt: eines fehlt meistens.',
  'error.toolbox_indent': 'Der Fehler steckt in der Werkzeugkiste, nicht in main.py. Ich habe den Tab befehle.py geöffnet, die Zeile ist markiert. Unter jeder Zeile mit Doppelpunkt rückt der Körper eine Stufe ein.',
  'error.toolbox_name': 'Der Fehler steckt in der Werkzeugkiste, nicht in main.py. Ich habe den Tab befehle.py geöffnet: Eine Funktion dort benutzt einen Namen, den Python nicht kennt. Steht dieser Befehl auch in der Kiste, genau so geschrieben?',
  'error.type': 'Falsche Anzahl oder Art von Argumenten. Vergleichen Sie den Aufruf mit der def-Zeile.',
  'error.recursion': 'Rekursion ohne Abbruch. Wie mein Kundendienst.',
  'error.forbidden': '{name}? Mikroweich nennt das Lizenzverletzung. Schreiben Sie es aus.',
  'error.tamper': 'Speichermanipulation. Das Inventar wollte sich selbst verschieben, ohne zu fahren. Ich habe es an Mikroweich gemeldet. Mikroweich nennt es ein Feature.',
  'error.locked': '{name}-Schleifen sind in Ihrer Lizenz noch nicht enthalten. Bis dahin: Funktionen.',
  'lint.bare_call': 'Zeile {line}: {name} ohne (). Sie haben den Befehl erwähnt, nicht ausgeführt.',
  'lint.never_called': 'Sie haben MOP-7 etwas beigebracht. Er hat es sich gemerkt. Getan hat er nichts.',
  'lint.sensor_no_call': 'Sie haben den Sensor nicht gefragt. Sie haben nur bestätigt, dass er existiert.',
  'lint.no_return': 'Ihre Funktion zeigt etwas an. Zurückgeben tut sie nichts. Die Bedingung bekommt None.',
  'lint.indented_call': 'Zeile {line} ist eingerückt und gehört darum noch zu {name}(). Ihr Hauptprogramm steckt in der Funktion. Shift+Tab rückt die Aufrufe an den linken Rand.',
  'lint.toolbox_bare': 'In der Werkzeugkiste steht {name} ohne (). Dort erwähnt, nicht ausgeführt. Darum steht das Inventar still.',
  'lint.toolbox_call': 'Ihre Werkzeugkiste arbeitet von selbst: In {name} steht ein Aufruf ausserhalb jeder Funktion. Er läuft bei jedem Import mit. In befehle.py gehören nur def-Blöcke, die Aufrufe gehören in main.py.',
}

/** `{want}` in error.door_code: the trace's error.want (kara-module.ts `_door_want`) in AURORA's words. */
export const AURORA_WANT: Record<KaraDoorWant, string> = {
  number: 'eine Zahl',
  bool: 'True oder False',
  text: 'ein Text',
}

/**
 * Placeholders a line may contain: {line} (lints), {name} (lints,
 * error.forbidden, error.door_*), {got} / {want} (error.door_code; want is
 * already the German phrase from AURORA_WANT).
 */
export type AuroraVars = { line?: number; name?: string; got?: string; want?: string }

function fill(text: string, vars: AuroraVars | undefined): string {
  if (!vars) return text
  return text.replace(/\{(line|name|got|want)\}/g, (m, k: keyof AuroraVars) => (vars[k] !== undefined ? String(vars[k]) : m))
}

/**
 * True when `text` is a built-in default, also with its placeholders filled
 * ({line} = digits, {name} = a Python identifier, {got} = a number, True,
 * False or None, {want} = an AURORA_WANT phrase). A door answer that is a
 * string or list does not match, so the student cannot make AURORA's voice
 * say arbitrary text; that card stays silent. Used by the TTS route to
 * allow on-demand rendering; every distinct filled text is its own voice file.
 */
export function isAuroraDefault(text: string): boolean {
  return Object.values(AURORA_DEFAULTS).some(t => {
    if (t === text) return true
    if (!t.includes('{')) return false
    const re = t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{line\}/g, '\\d{1,5}').replace(/\{name\}/g, '[A-Za-z_][A-Za-z0-9_]{0,40}')
      .replace(/\{got\}/g, '(?:-?\\d{1,12}(?:\\.\\d{1,6})?|True|False|None)').replace(/\{want\}/g, `(?:${Object.values(AURORA_WANT).join('|')})`)
    return new RegExp(`^${re}$`).test(text)
  })
}

interface AuroraOpts {
  sub?: string
  failStreak?: number
  /** 'fail': the goals still missing (trace.goal.missing), in goal order; only the first one picks a line. */
  missing?: string[]
  /** 'win': limits the run exceeded (a star short): 'memory', 'energy'. */
  over?: ('memory' | 'energy')[]
}

/**
 * AURORA's line for a run result, or undefined when nothing fits.
 *
 *   event 'error' with sub:  level error.<sub> → level error → default error.<sub> → default error
 *   event 'fail', failStreak ≥ 3:  level fail.3 → (as 'fail')
 *   event 'fail':            level fail.<first missing goal> → level fail → default fail
 *                            (goal order of kara-module.ts _goal: exit, target, collect, boxes, chips, logs, output)
 *   event 'win', over limits: level win.<limit> (memory first) → (as 'win'); no
 *                            defaults, so a story win line stays unless the level asks
 *   other events:            level <event> → default <event>
 *                            (lints: event 'lint.<code>', e.g. 'lint.bare_call')
 *
 * `vars` fills {line} / {name} in the chosen text (level or default).
 *
 * Level lines always win over course defaults, so a level's generic
 * `aurora.error` also covers subs the level does not name.
 */
export function auroraLine(
  config: Pick<KaraConfig, 'aurora'>,
  event: string,
  opts: AuroraOpts & { vars?: AuroraVars } = {},
): KaraMessage | undefined {
  const m = pick(config.aurora, event, opts)
  return m && opts.vars ? { ...m, text: fill(m.text, opts.vars) } : m
}

function pick(aurora: Record<string, KaraMessage>, event: string, opts: AuroraOpts): KaraMessage | undefined {
  const def = (key: string): KaraMessage | undefined =>
    AURORA_DEFAULTS[key] ? { text: AURORA_DEFAULTS[key], speaker: 'AURORA' } : undefined
  if (event === 'error') {
    const sub = opts.sub ? `error.${opts.sub}` : null
    return (sub ? aurora[sub] : undefined) ?? aurora.error ?? (sub ? def(sub) : undefined) ?? def('error')
  }
  if (event === 'fail') {
    if ((opts.failStreak ?? 0) >= 3 && aurora['fail.3']) return aurora['fail.3']
    const first = opts.missing?.[0]
    if (first && aurora[`fail.${first}`]) return aurora[`fail.${first}`]
  }
  if (event === 'win' && opts.over?.length) {
    for (const k of opts.over) if (aurora[`win.${k}`]) return aurora[`win.${k}`]
  }
  return aurora[event] ?? def(event)
}
