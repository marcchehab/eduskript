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
    if (!dir || dir === '/') continue
    // Words the direction applies to: up to `{/}`, the next marker or the sentence end.
    const rest = body.slice(m.index! + m[0].length)
    const span = displayText(rest.split(/\{\/\}|\{/)[0].match(/^[^.!?…]*[.!?…]?/)?.[0] ?? '')
    const before = displayText(body.slice(0, m.index)).split(' ').slice(-4).join(' ')
    if (span) notes.push(`Ab «${span}»: ${dir}.`)
    else if (before) notes.push(`Nach «${before}»: ${dir}.`)
  }
  return `Regie für diese Zeile (befolgen, NIE aussprechen): ${notes.join(' ')}`
}
