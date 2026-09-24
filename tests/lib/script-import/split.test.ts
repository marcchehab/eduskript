import { describe, it, expect } from 'vitest'
import { splitIntoPages, pageSlug, MAX_PAGES } from '@/lib/script-import/split'

const para = (n: number) => 'Lorem ipsum dolor sit amet. '.repeat(n)

describe('splitIntoPages', () => {
  it('uses the sole H1 as title and splits at H2', () => {
    const md = `# Säuren\n\nIntro\n\n## Kapitel A\n\n${para(20)}\n\n### Aufgabe\n\nx\n\n## Kapitel B\n\n${para(20)}`
    const { title, pages } = splitIntoPages(md, 'file')
    expect(title).toBe('Säuren')
    expect(pages.map((p) => p.title)).toEqual(['Kapitel A', 'Kapitel B'])
    expect(pages[0].content).toMatch(/^# Kapitel A\n\nIntro/)
    expect(pages[0].content).toContain('## Aufgabe') // H3 promoted to H2
  })

  it('splits at H1 when there are several H1s, file name as title', () => {
    const md = `# Eins\n\n${para(20)}\n\n# Zwei\n\n${para(20)}`
    const { title, pages } = splitIntoPages(md, 'Mein Skript')
    expect(title).toBe('Mein Skript')
    expect(pages).toHaveLength(2)
  })

  it('merges a tiny first chapter into the next one', () => {
    const md = `## Lernziele\n\n- a\n\n## Hauptteil\n\n${para(20)}`
    const { pages } = splitIntoPages(md, 'x')
    expect(pages).toHaveLength(1)
    expect(pages[0].title).toBe('Hauptteil')
    expect(pages[0].content).toContain('## Lernziele')
  })

  it('keeps a headingless document as one page', () => {
    const { pages } = splitIntoPages(para(5), 'Blatt 3')
    expect(pages).toHaveLength(1)
    expect(pages[0].title).toBe('Blatt 3')
  })

  it('ignores headings inside code fences', () => {
    const md = `## A\n\n${para(20)}\n\n\`\`\`python\n## not a heading\n\`\`\`\n\n## B\n\n${para(20)}`
    expect(splitIntoPages(md, 'x').pages).toHaveLength(2)
  })

  it('caps the page count and dedupes slugs', () => {
    const md = Array.from({ length: 60 }, () => `## Gleich\n\n${para(20)}`).join('\n\n')
    const { pages } = splitIntoPages(md, 'x')
    expect(pages.length).toBeLessThanOrEqual(MAX_PAGES)
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length)
  })
})

describe('pageSlug', () => {
  it('transliterates umlauts and strips math', () => {
    expect(pageSlug('1 Die Brønsted-Säure $x^2$')).toBe('1-die-bronsted-saeure')
    expect(pageSlug('???')).toBe('seite')
  })
})

describe('splitIntoPages tiny-chapter merge', () => {
  it('appends a tiny middle chapter to the previous one', () => {
    const md = `## A\n\n${para(20)}\n\n## Übungen\n\n1. x\n\n## B\n\n${para(20)}`
    const { pages } = splitIntoPages(md, 'x')
    expect(pages.map((p) => p.title)).toEqual(['A', 'B'])
    expect(pages[0].content).toContain('## Übungen')
    expect(pages[1].content).not.toContain('Übungen')
  })
  it('counts an image as substantial content', () => {
    const md = `## Einführung\n\nKurz.\n\n![d](image-1.png)\n\n## B\n\n${para(20)}`
    expect(splitIntoPages(md, 'x').pages.map((p) => p.title)).toEqual(['Einführung', 'B'])
  })
})

describe('exercise headings', () => {
  it('never starts a page at "Aufgabe N" / "Lösung N"', () => {
    const md = `## Kapitel\n\n${para(20)}\n\n## Lösungen\n\n${para(12)}\n\n## Aufgabe 7:\n\n${para(12)}\n\n## Aufgabe 9:\n\n${para(12)}`
    const { pages } = splitIntoPages(md, 'x')
    expect(pages.map((p) => p.title)).toEqual(['Kapitel', 'Lösungen'])
    expect(pages[1].content).toContain('## Aufgabe 7:')
  })
})
