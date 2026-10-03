import { describe, expect, it } from 'vitest'
import { auroraVoiceLines, setVoiceLine } from '@/lib/kara/voice-line-edit'

const BLOCK = `#####
#>.E#
#####
---
id: w1-l1
goal: exit
intro: [froh] Erste Zeile. {Pause} Ende.
intro: Zweite Zeile.
intro: Brandt spricht. | speaker=BRANDT
log: Kein AURORA-Text. | speaker=JONAS
aurora.win: Gewonnen. | audio=win.mp3
aurora.fail.3: Dritter Versuch.`

describe('auroraVoiceLines', () => {
  it('lists AURORA lines in order and skips other speakers', () => {
    const own = auroraVoiceLines(BLOCK).filter(l => !l.isDefault)
    expect(own.map(l => [l.key, l.index, l.text])).toEqual([
      ['intro', 0, '[froh] Erste Zeile. {Pause} Ende.'],
      ['intro', 1, 'Zweite Zeile.'],
      ['aurora.win', 0, 'Gewonnen.'],
      ['aurora.fail.3', 0, 'Dritter Versuch.'],
    ])
  })
  it('adds defaults the level does not override', () => {
    const lines = auroraVoiceLines(BLOCK)
    expect(lines.some(l => l.isDefault && l.key === 'aurora.fail')).toBe(true)
    expect(lines.some(l => l.isDefault && l.key === 'aurora.win')).toBe(false)
  })
})

describe('setVoiceLine', () => {
  it('replaces only the n-th line and keeps every other byte', () => {
    const out = setVoiceLine(BLOCK, 'intro', 1, 'Neu.')
    expect(out).toBe(BLOCK.replace('intro: Zweite Zeile.', 'intro: Neu.'))
  })
  it('keeps named options', () => {
    expect(setVoiceLine(BLOCK, 'aurora.win', 0, 'Bravo.')).toContain('aurora.win: Bravo. | audio=win.mp3')
  })
  it('appends a missing key at the end of the config', () => {
    const out = setVoiceLine(BLOCK + '\n', 'aurora.loop', 0, 'Schleife.')
    expect(out).toBe(BLOCK + '\naurora.loop: Schleife.\n')
  })
  it('adds a config section when the block has none', () => {
    expect(setVoiceLine('#>E#', 'aurora.win', 0, 'Ja.')).toBe('#>E#\n---\naurora.win: Ja.')
  })
  it('rejects the field separator', () => {
    expect(() => setVoiceLine(BLOCK, 'intro', 0, 'a | b')).toThrow()
  })
})
