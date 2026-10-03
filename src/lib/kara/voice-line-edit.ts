/**
 * Reading and rewriting the AURORA lines of a raw ```kara-world block, for
 * editing them in place on the level page (kara-voice-editor.tsx). Pure
 * string work on the block text; the page is then saved with an exact-text
 * replace (/api/pages/[id]/replace), so this must keep every other byte of
 * the block unchanged.
 *
 * AURORA lines = `intro:` without a speaker (or speaker=AURORA),
 * `aftermath.text:` / `aftermath.end:` and every `aurora.<key>:`. Course-wide
 * defaults (AURORA_DEFAULTS) the level does not override are listed too;
 * saving one adds an `aurora.<key>:` line at the end of the config.
 * Limitation: a line's text cannot contain `|` (field separator) or a newline.
 */

import { AURORA_DEFAULTS } from './aurora-defaults'

export interface VoiceLine {
  /** Config key as written, lower-case: `intro`, `aurora.fail.3`, `aftermath.text` */
  key: string
  /** n-th line with this key (intro can repeat) */
  index: number
  text: string
  /** Not in the block yet: a course-wide default */
  isDefault: boolean
}

const LINE = /^(\s*)([a-z][a-z0-9._]*)(\s*:\s*)(.*)$/i
const NAMED = /^[a-z]+=/

/** Line indices of the config part (after the first `---`), or [] when there is none. */
function configStart(lines: string[]): number {
  const i = lines.findIndex(l => /^---\s*$/.test(l))
  return i === -1 ? -1 : i + 1
}

function split(value: string): { text: string; named: string[] } {
  const parts = value.split('|').map(p => p.trim())
  return { text: parts.filter(p => !NAMED.test(p)).join(' | '), named: parts.filter(p => NAMED.test(p)) }
}

function isAurora(key: string, named: string[]): boolean {
  if (key.startsWith('aurora.') || key === 'aftermath.text' || key === 'aftermath.end') return true
  if (key !== 'intro') return false
  const sp = named.find(n => n.startsWith('speaker='))
  return !sp || sp.slice(8).trim().toUpperCase() === 'AURORA'
}

export function auroraVoiceLines(block: string): VoiceLine[] {
  const lines = block.replace(/\r/g, '').split('\n')
  const start = configStart(lines)
  const out: VoiceLine[] = []
  const seen = new Map<string, number>()
  if (start !== -1) {
    for (const raw of lines.slice(start)) {
      const m = raw.match(LINE)
      if (!m) continue
      const key = m[2].toLowerCase()
      const n = seen.get(key) ?? 0
      seen.set(key, n + 1)
      const { text, named } = split(m[4])
      if (isAurora(key, named)) out.push({ key, index: n, text, isDefault: false })
    }
  }
  for (const [k, text] of Object.entries(AURORA_DEFAULTS)) {
    if (!seen.has(`aurora.${k}`)) out.push({ key: `aurora.${k}`, index: 0, text, isDefault: true })
  }
  return out
}

/** The block with the `index`-th `key:` line's text replaced (named options kept), or appended when missing. */
export function setVoiceLine(block: string, key: string, index: number, text: string): string {
  const clean = text.replace(/\s*\n\s*/g, ' ').trim()
  if (clean.includes('|')) throw new Error('A voice line cannot contain "|".')
  const lines = block.split('\n')
  const start = configStart(lines.map(l => l.replace(/\r$/, '')))
  if (start !== -1) {
    let n = 0
    for (let i = start; i < lines.length; i++) {
      const m = lines[i].replace(/\r$/, '').match(LINE)
      if (!m || m[2].toLowerCase() !== key) continue
      if (n++ !== index) continue
      const { named } = split(m[4])
      const cr = lines[i].endsWith('\r') ? '\r' : ''
      lines[i] = `${m[1]}${m[2]}${m[3]}${clean}${named.map(o => ` | ${o}`).join('')}${cr}`
      return lines.join('\n')
    }
  }
  // Not there: append after the last non-empty line (adding `---` if the block has no config).
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last--
  const add = start === -1 ? ['---', `${key}: ${clean}`] : [`${key}: ${clean}`]
  lines.splice(last + 1, 0, ...add)
  return lines.join('\n')
}
