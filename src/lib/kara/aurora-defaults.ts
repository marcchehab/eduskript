/**
 * Course-wide AURORA lines (German: they are MOP-7 course content, not UI).
 * A level overrides any of them with `aurora.<key>:` in its kara-world config;
 * see `auroraLine` for the lookup order. The keys under `error.` match the
 * error `sub` codes set in kara-module.ts (`_error_sub`).
 *
 * The TTS route (src/app/api/kara/tts/route.ts) treats every value here as a
 * real Kara line, so on-demand voice rendering works for them.
 */

import type { KaraConfig, KaraMessage } from './world'

/** Error classes the Python runner reports as `error.sub`. */
export type KaraErrorSub =
  // MOP-7 refused an action (KaraError.code)
  | 'wall' | 'terminal' | 'door' | 'laser' | 'box' | 'acid' | 'item' | 'no_item' | 'no_switch' | 'no_terminal'
  // Python exception types
  | 'name' | 'module' | 'indent' | 'syntax' | 'type' | 'recursion'

export const AURORA_DEFAULTS: Record<string, string> = {
  'win': 'Auftrag erledigt. Ich bin fast beeindruckt.',
  'fail': 'Programm zu Ende. Auftrag nicht erledigt.',
  'loop': 'Endlosschleife. Wie … vertraut.',
  'error': 'Programm abgebrochen. Die Zeile ist im Editor markiert, die Meldung steht daneben.',
  'error.wall': 'Wand. Python meldet es auf Englisch, ich übersetze: Wand. Die Zeile ist markiert.',
  'error.terminal': 'Vor dem Inventar steht ein Terminal. Terminals liest man, man fährt nicht durch.',
  'error.door': 'Die Tür ist zu. Erst der Schalter, dann die Tür. Reihenfolge ist alles.',
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
  'error.type': 'Falsche Anzahl oder Art von Argumenten. Vergleichen Sie den Aufruf mit der def-Zeile.',
  'error.recursion': 'Rekursion ohne Abbruch. Wie mein Kundendienst.',
}

/**
 * AURORA's line for a run result, or undefined when nothing fits.
 *
 *   event 'error' with sub:  level error.<sub> → level error → default error.<sub> → default error
 *   event 'fail', failStreak ≥ 3:  level fail.3 → (as 'fail')
 *   other events:            level <event> → default <event>
 *
 * Level lines always win over course defaults, so a level's generic
 * `aurora.error` also covers subs the level does not name.
 */
export function auroraLine(
  config: Pick<KaraConfig, 'aurora'>,
  event: string,
  opts: { sub?: string; failStreak?: number } = {},
): KaraMessage | undefined {
  const { aurora } = config
  const def = (key: string): KaraMessage | undefined =>
    AURORA_DEFAULTS[key] ? { text: AURORA_DEFAULTS[key], speaker: 'AURORA' } : undefined
  if (event === 'error') {
    const sub = opts.sub ? `error.${opts.sub}` : null
    return (sub ? aurora[sub] : undefined) ?? aurora.error ?? (sub ? def(sub) : undefined) ?? def('error')
  }
  if (event === 'fail' && (opts.failStreak ?? 0) >= 3 && aurora['fail.3']) return aurora['fail.3']
  return aurora[event] ?? def(event)
}
