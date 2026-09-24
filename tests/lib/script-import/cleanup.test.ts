import { describe, it, expect } from 'vitest'
import { chunkMarkdown, keptContent, stripTextboxMarkers } from '@/lib/script-import/cleanup'

describe('chunkMarkdown', () => {
  it('packs small sections and respects the size limit', () => {
    const md = Array.from({ length: 10 }, (_, i) => `## S${i}\n\n${'x'.repeat(300)}`).join('\n\n')
    const chunks = chunkMarkdown(md, 1000)
    expect(chunks.every((c) => c.length <= 1000)).toBe(true)
    expect(chunks.join('\n\n').replace(/\s/g, '')).toBe(md.replace(/\s/g, ''))
  })

  it('splits an oversized section at blank lines', () => {
    const md = Array.from({ length: 10 }, () => 'y'.repeat(300)).join('\n\n')
    expect(chunkMarkdown(md, 1000).length).toBeGreaterThan(1)
  })
})

describe('keptContent', () => {
  const orig = 'Die Säure HCl reagiert mit H<sub>2</sub>O zu H<sub>3</sub>O<sup>+</sup>.\n\n![Becher](image-1.png)\n\nMerke: Protonen.'
  it('accepts a markup-only rewrite', () => {
    const cleaned = 'Die Säure $\\ce{HCl}$ reagiert mit $\\ce{H2O}$ zu $\\ce{H3O+}$.\n\n![Becher](image-1.png)\n\n> [!note] Merke\n> Protonen.'
    expect(keptContent(orig, cleaned)).toBe(true)
  })
  it('rejects dropped images', () => {
    expect(keptContent(orig, orig.replace('![Becher](image-1.png)', ''))).toBe(false)
  })
  it('rejects a summary', () => {
    expect(keptContent(orig + ' ' + 'Langer Text. '.repeat(50), 'Kurz.')).toBe(false)
  })
})

describe('formula images', () => {
  it('caps formula images per chunk', () => {
    const md = Array.from({ length: 100 }, (_, i) => `Text ${i} ![](formula-${i + 1}.png)`).join('\n\n')
    const chunks = chunkMarkdown(md, 100_000, 40)
    expect(chunks.length).toBe(3)
    expect(chunks.every((c) => (c.match(/formula-/g) ?? []).length <= 40)).toBe(true)
  })

  it('lets formula refs turn into LaTeX but not ordinary images', () => {
    const orig = 'Es gilt ![](formula-1.png) und ![Skizze](image-1.png) für alle x im Intervall.'
    expect(keptContent(orig, 'Es gilt $H(x) = F(g(x))$ und ![Skizze](image-1.png) für alle x im Intervall.')).toBe(true)
    expect(keptContent(orig, 'Es gilt $H(x) = F(g(x))$ und für alle x im Intervall.')).toBe(false)
  })
})

describe('stripTextboxMarkers', () => {
  it('removes leftover markers, also inside callouts', () => {
    expect(stripTextboxMarkers('a\nTEXTFELD-ANFANG\nb\n> TEXTFELD-ENDE\nc')).toBe('a\nb\nc')
  })
})

describe('keptContent with sized images', () => {
  it('tracks <img src> references too', () => {
    const orig = 'Ein Text mit genug Inhalt für den Test. <img src="image-2.png" alt="" style="width: 40%" />'
    expect(keptContent(orig, 'Ein Text mit genug Inhalt für den Test.')).toBe(false)
    expect(keptContent(orig, orig)).toBe(true)
  })
})
