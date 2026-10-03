/**
 * Spoken-line directions for Kara voice lines (AURORA etc.):
 *
 *   [trocken, gelangweilt] Programm beendet. {Pause} Ziel nicht erreicht. {schnell} Wie immer. {/}
 *
 * `[…]` at the very start applies to the whole line; `{…}` inside the text
 * applies from there until `{/}` or the end of the sentence. Directions are
 * free text. The TTS model gets the clean text plus a director's note built
 * from them (directionsNote; used by voice-tts.server.ts and voices.mts). Screens show `displayText` (directions
 * removed). The raw text including directions is what gets hashed, so
 * editing a direction renders a new take.
 */

/** The line as shown on screen: directions removed, whitespace tidied. */
export function displayText(text: string): string {
  return text
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/\s*\{[^}]*\}\s*/g, ' ')
    .replace(/ +([.,!?…:;])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** True when the line carries any `[…]` or `{…}` direction. */
export function hasDirections(text: string): boolean {
  return /^\s*\[[^\]]*\]|\{[^}]*\}/.test(text)
}

/**
 * Directions rewritten as a director's note for the TTS system prompt. The
 * model only gets `displayText` as the text to speak: given inline `{…}`
 * markers it read them aloud (tested with gpt-audio, 2026-10-03), so each
 * marker is described by the words it precedes instead. null = no directions.
 */
export function directionsNote(text: string): string | null {
  if (!hasDirections(text)) return null
  const notes: string[] = []
  const whole = text.match(/^\s*\[([^\]]*)\]/)
  if (whole) notes.push(`Ganze Zeile: ${whole[1].trim()}.`)
  const body = text.replace(/^\s*\[[^\]]*\]\s*/, '')
  for (const m of body.matchAll(/\{([^}]*)\}/g)) {
    const dir = m[1].trim()
    if (!dir || dir === '/' || /^\/?werbung$/i.test(dir)) continue // {werbung}: background music, not a direction
    // Words the direction applies to: up to `{/}`, the next marker or the sentence end.
    const rest = body.slice(m.index! + m[0].length)
    const span = displayText(rest.split(/\{\/\}|\{/)[0].match(/^[^.!?…]*[.!?…]?/)?.[0] ?? '')
    const before = displayText(body.slice(0, m.index)).split(' ').slice(-4).join(' ')
    if (span) notes.push(`Ab «${span}»: ${dir}.`)
    else if (before) notes.push(`Nach «${before}»: ${dir}.`)
  }
  return `Regie für diese Zeile (befolgen, NIE aussprechen): ${notes.join(' ')}`
}

/**
 * Words gpt-audio mispronounces in German text, respelled for the TTS only
 * (screens keep the real word). "Terminal" came out German ("Ter-mi-NAHL")
 * instead of the English loanword. Add pairs here; lines containing a word
 * get a new voice hash (voiceLineHash), so they re-render and lose a picked take.
 */
const PRONOUNCE: [RegExp, string][] = [
  [/\bTerminal(s?)\b/g, 'Törminel$1'],
  [/\bTab(s?)\b/g, 'Täb$1'],
]

/**
 * A remark in round brackets is read as a separate hint:
 * «Hallo miteinander (ich meine auch Chris).» → «Hallo miteinander. Hinweis: Ich meine auch Chris.»
 * Only brackets after a space with a letter inside, so calls like `read_log()`
 * or `print(...)` stay as they are.
 */
function bracketsAsHints(text: string): string {
  // Mid-sentence («A (B), C») ends the hint with a full stop and capitalises C.
  return text.replace(/\s+\(([^()]*\p{L}[^()]*)\)(?:([.!?…])|[,;:])?(\s*)(\p{L})?/gu,
    (_, inner: string, end: string | undefined, space: string, next: string | undefined) => {
      const hint = inner.trim()
      return `. Hinweis: ${hint.charAt(0).toUpperCase()}${hint.slice(1)}${end ?? '.'}${next ? ` ${next.toUpperCase()}` : space}`
    })
}

/** Text the TTS model reads aloud: directions removed, (remarks) as hints, PRONOUNCE respellings applied. */
export function spokenText(text: string): string {
  return PRONOUNCE.reduce((t, [re, say]) => t.replace(re, say), bracketsAsHints(displayText(text)))
}

/**
 * `{werbung}` … `{/werbung}` marks an ad: the browser plays the ad jingle
 * (public/kara/sfx/werbung.mp3) softly under that part (voice.ts). Without
 * `{/werbung}` it runs to the end of the line. The TTS audio has no word
 * timings, so the span is estimated from the share of on-screen characters
 * before/after the markers: roughly right, not exact.
 * Returns fractions of the line's duration (0..1), or null without marker.
 */
export function adSpan(text: string): { from: number; to: number } | null {
  const body = text.replace(/^\s*\[[^\]]*\]\s*/, '')
  const start = body.search(/\{werbung\}/i)
  if (start === -1) return null
  const total = displayText(body).length || 1
  const endAt = body.search(/\{\/werbung\}/i)
  const from = displayText(body.slice(0, start)).length / total
  const to = endAt === -1 ? 1 : displayText(body.slice(0, endAt)).length / total
  return { from: Math.min(1, from), to: Math.max(from, Math.min(1, to)) }
}
