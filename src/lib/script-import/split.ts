/**
 * Split converted markdown into Eduskript pages (one per chapter).
 *
 * Heuristic, deterministic:
 * 1. If the document's first heading is its only H1, it becomes the skript
 *    title (else the file name) and is removed from the body.
 * 2. Chapter level = H1 if the remaining body has ≥2 H1, else H2 if ≥2 H2,
 *    else the whole document is one page.
 * 3. Text before the first chapter heading (school/class line, intro) is
 *    prepended to the first chapter.
 * 4. Chapters shorter than MIN_CHAPTER_CHARS (images count IMAGE_CHARS) are
 *    appended to the previous chapter as a sub-section; a tiny first chapter
 *    (e.g. "Lernziele") is prepended to the next one. No near-empty pages. Then consecutive chapters are grouped until ≤ MAX_PAGES remain.
 * 5. Each page starts with `# <chapter title>`; its sub-headings are promoted
 *    so the chapter heading level maps to H1 (Eduskript pages start with H1).
 *
 * Headings inside fenced code blocks are ignored. O(lines).
 */
import { generateSlug } from '@/lib/markdown'

export interface ImportPage {
  title: string
  slug: string
  content: string
}

export const MAX_PAGES = 25
const MIN_CHAPTER_CHARS = 300
const IMAGE_CHARS = 300
const EXERCISE_HEADING = /^(Aufgabe|Lösung|Loesung|Übung|Exercise|Solution)\s*\d/i

interface Line {
  text: string
  level: number // 0 = not a heading
}

function scanLines(md: string): Line[] {
  let inFence = false
  return md.split('\n').map((text) => {
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence
    const m = !inFence && text.match(/^(#{1,6})\s+\S/)
    return { text, level: m ? m[1].length : 0 }
  })
}

const headingText = (line: string) => line.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim()

/** Slug for a page title; transliterates German umlauts before generateSlug strips them. */
export function pageSlug(title: string): string {
  const base = generateSlug(
    title
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[øØ]/g, 'o')
      .replace(/[æÆ]/g, 'ae')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\$[^$]*\$/g, '')
  ).replace(/^-|-$/g, '')
  return base.slice(0, 60).replace(/-$/, '') || 'seite'
}

export function splitIntoPages(
  markdown: string,
  fallbackTitle: string
): { title: string; pages: ImportPage[] } {
  let lines = scanLines(markdown.trim())

  let title = fallbackTitle
  const firstHeading = lines.findIndex((l) => l.level > 0)
  if (firstHeading >= 0 && lines[firstHeading].level === 1) {
    // Only the sole H1 is the document title; several H1s are chapters.
    const before = lines.slice(0, firstHeading).some((l) => l.text.trim())
    if (!before && lines.filter((l) => l.level === 1).length === 1) {
      title = headingText(lines[firstHeading].text)
      lines = lines.filter((_, i) => i !== firstHeading)
    }
  }

  // "Aufgabe 7", "Lösung 3", "Übung 2" never start a page: in solution
  // sections the model tends to give each one its own heading, which would
  // otherwise turn every solution into a separate page.
  lines = lines.map((l) =>
    l.level > 0 && l.level <= 2 && EXERCISE_HEADING.test(headingText(l.text)) ? { ...l, level: 3 } : l
  )

  const count = (lvl: number) => lines.filter((l) => l.level === lvl).length
  const chapterLevel = count(1) >= 2 ? 1 : count(2) >= 2 ? 2 : 0

  type Chapter = { title: string; body: Line[] }
  let chapters: Chapter[] = []
  let intro: Line[] = []
  if (chapterLevel === 0) {
    chapters = [{ title, body: lines }]
  } else {
    for (const line of lines) {
      if (line.level === chapterLevel) {
        chapters.push({ title: headingText(line.text), body: [] })
      } else if (line.level > 0 && line.level < chapterLevel) {
        // A stray higher-level heading between chapters: keep as content.
        ;(chapters.at(-1)?.body ?? intro).push({ ...line, level: chapterLevel })
      } else {
        ;(chapters.at(-1)?.body ?? intro).push(line)
      }
    }
  }

  // Images count as IMAGE_CHARS: a short section with a figure is a real chapter.
  const size = (body: Line[]) =>
    body.reduce((n, l) => n + l.text.trim().length + (/!\[[^\]]*\]\(/.test(l.text) ? IMAGE_CHARS : 0), 0)
  const asSubheading = (c: Chapter): Line => ({
    text: `${'#'.repeat(chapterLevel + 1)} ${c.title}`,
    level: chapterLevel + 1,
  })

  // Tiny chapters are appended to the previous chapter as a sub-section (an
  // "Übungen" block belongs to the chapter before it); a tiny FIRST chapter
  // (e.g. "Lernziele") is prepended to the next one instead.
  const merged: Chapter[] = []
  let carry: Line[] = []
  chapters.forEach((c, i) => {
    const tiny = chapters.length > 1 && size(c.body) < MIN_CHAPTER_CHARS
    if (tiny && merged.length > 0) {
      merged[merged.length - 1].body.push({ text: '', level: 0 }, asSubheading(c), ...c.body)
    } else if (tiny && i < chapters.length - 1) {
      carry = [...carry, asSubheading(c), ...c.body]
    } else {
      merged.push({ title: c.title, body: [...carry, ...c.body] })
      carry = []
    }
  })
  // Intro goes first, above any headings merged into the first chapter.
  if (chapterLevel > 0 && intro.some((l) => l.text.trim())) merged[0].body = [...intro, ...merged[0].body]

  // Cap page count by grouping consecutive chapters.
  let grouped = merged
  if (merged.length > MAX_PAGES) {
    const per = Math.ceil(merged.length / MAX_PAGES)
    grouped = []
    for (let i = 0; i < merged.length; i += per) {
      const group = merged.slice(i, i + per)
      grouped.push({
        title: group[0].title,
        body: group.flatMap((c, j) =>
          j === 0 ? c.body : [{ text: `${'#'.repeat(chapterLevel + 1)} ${c.title}`, level: chapterLevel + 1 }, ...c.body]
        ),
      })
    }
  }

  const shift = Math.max(chapterLevel - 1, 0)
  const used = new Set<string>()
  const pages = grouped.map((c) => {
    const body = c.body
      .map((l) => (l.level > 0 ? '#'.repeat(Math.max(l.level - shift, 2)) + ' ' + headingText(l.text) : l.text))
      .join('\n')
      .trim()
    let slug = pageSlug(c.title)
    for (let n = 2; used.has(slug); n++) slug = `${pageSlug(c.title)}-${n}`
    used.add(slug)
    return { title: c.title, slug, content: `# ${c.title}\n\n${body}\n` }
  })

  return { title, pages }
}
