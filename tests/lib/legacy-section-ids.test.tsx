/**
 * Section ids changed on 2026-11-19 (heading-section-ids.ts, ID FORMAT). Strokes
 * in production store the OLD ids. These tests prove that on unchanged content
 * every old id still resolves to the very element it resolved to before, and
 * that the new ids do not shift when content is inserted elsewhere.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import type { Root, Element } from 'hast'
import { remarkPlugins, compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { rehypeHeadingSectionIds } from '@/lib/rehype-plugins/heading-section-ids'
import { LEGACY_SECTION_IDS_ATTR, findSectionElement, readLegacySectionIds } from '@/lib/annotations/reposition-strokes'
import { rehypeLegacyHeadingSectionIds } from './fixtures/legacy-heading-section-ids'

vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: null, updateData: vi.fn(), isLoading: false }),
}))

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/sections', name), 'utf8')

// jsdom has none; callouts observe their body height.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// Only blocks that render without app providers (no plugin/code-editor; those
// are covered by the hast comparison above).
const DOM_MD = [
  '# Title',
  '',
  '> [!tip] Tip',
  '> Body.',
  '',
  '## 1 Basics',
  '',
  '```',
  'plain',
  '```',
  '',
  '> [!abstract]- Aufgabe',
  '> Folded.',
  '',
  '## 2 Addieren',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '<flex>',
  '<flex-item>',
  '',
  'Left',
  '',
  '</flex-item>',
  '</flex>',
  '',
  '## 2 Addieren',
].join('\n')

const SYNTHETIC = [
  '# Title',
  '',
  'Intro text.',
  '',
  '> [!tip] Before any h2 (scoped to the h1)',
  '> Tip body.',
  '',
  '## 1 Basics',
  '',
  '```python',
  'x = 1',
  '```',
  '',
  '```python editor',
  'print(1)',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '<plugin src="t/lab" />',
  '',
  '<plugin src="t/lab" />',
  '',
  '<plugin />',
  '',
  '### Übungen',
  '',
  '> [!abstract] Aufgabe 1',
  '> Do it.',
  '',
  '<solution title="Lösung 1">',
  '',
  'Answer.',
  '',
  '</solution>',
  '',
  '## 2 More',
  '',
  '### Übungen',
  '',
  '<flex>',
  '<flex-item>',
  '',
  '> [!note] Inside flex',
  '> Not its own section.',
  '',
  '</flex-item>',
  '</flex>',
  '',
  '<plugin src="t/lab" />',
  '',
  '## Übungen',
  '',
  '## Übungen',
  '',
  '> [!warning] Last',
  '> Body.',
].join('\n')

async function toHast(md: string): Promise<Root> {
  // compileMarkdown's preprocessing expands self-closing custom tags (HTML
  // would otherwise nest everything after `<plugin />` inside it).
  md = md.replace(/<(plugin|excali|spacer)\b([^>]*?)\s*\/>/g, '<$1$2></$1>')
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
  return (await processor.run(processor.parse(md))) as Root
}

async function runPlugin(tree: Root, plugin: () => (tree: Root) => void): Promise<Root> {
  const copy = structuredClone(tree)
  plugin()(copy)
  return copy
}

/** [tagName, data-section-id] of every anchored node, document order. */
function anchors(tree: Root | Element): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (n: Root | Element) => {
    if (n.type === 'element') {
      const id = n.properties?.['data-section-id']
      if (typeof id === 'string') out.push([n.tagName, id])
    }
    for (const c of n.children) if (c.type === 'element') walk(c)
  }
  walk(tree)
  return out
}

function legacyMapOf(tree: Root): Record<string, string> {
  const top = tree.children[0] as Element
  return JSON.parse(String(top.properties[LEGACY_SECTION_IDS_ATTR] ?? '{}'))
}

async function currentIds(md: string) {
  const tree = await runPlugin(await toHast(md), rehypeHeadingSectionIds)
  return anchors(tree).map(([, id]) => id)
}

describe.each([
  ['rechnen-mit-pfeilen.md', () => fixture('rechnen-mit-pfeilen.md')],
  ['uebungen-vektoren-als-pfeile.md', () => fixture('uebungen-vektoren-als-pfeile.md')],
  ['synthetic', () => SYNTHETIC],
])('legacy ids on unchanged content: %s', (_name, md) => {
  it('every old id maps to the node that carried it before', async () => {
    const hast = await toHast(md())
    const oldTree = await runPlugin(hast, rehypeLegacyHeadingSectionIds)
    const newTree = await runPlugin(hast, rehypeHeadingSectionIds)
    const map = legacyMapOf(newTree)

    const oldAnchors = anchors(oldTree)
    // New since 2026-11-19, no legacy counterpart: <solution> end sentinels.
    const newAnchors = anchors(newTree).filter(([, id]) => !id.startsWith('solution@'))

    expect(newAnchors.length).toBe(oldAnchors.length)
    oldAnchors.forEach(([tag, legacyId], i) => {
      const [newTag, newId] = newAnchors[i]
      expect(newTag).toBe(tag)
      if (legacyId === 'paper-top') {
        expect(newId).toBe('paper-top')
      } else {
        expect(map[legacyId]).toBe(newId)
      }
    })
    // Disjoint namespaces: no old id is also a current id of another node.
    const current = new Set(newAnchors.map(([, id]) => id))
    for (const [, legacyId] of oldAnchors) {
      if (legacyId !== 'paper-top') expect(current.has(legacyId)).toBe(false)
    }
  })

})

describe('legacy ids in the rendered DOM (unchanged content)', () => {
  it('every old id resolves to the element with its mapped current id', async () => {
    const oldIds = anchors(await runPlugin(await toHast(DOM_MD), rehypeLegacyHeadingSectionIds)).map(([, id]) => id)
    expect(oldIds).toEqual(expect.arrayContaining(['callout-0', 'callout-1-end', 'pre-0', 'table-0', 'h2-2-addieren', 'flex-0-end']))
    const components = createMarkdownComponents(createEmptySkriptFiles(), { pageId: 'p1' })
    const tree = (await compileMarkdown(DOM_MD, { components })) as ReactNode
    const { container } = render(<>{tree}</>)
    const map = readLegacySectionIds(container)
    expect(map.size).toBeGreaterThan(0)

    let resolved = 0
    for (const legacyId of oldIds) {
      const el = findSectionElement(legacyId, container, map)
      const expected = legacyId === 'paper-top'
        ? container.querySelector('[data-section-id="paper-top"]')
        : container.querySelector(`[data-section-id="${CSS.escape(map.get(legacyId)!)}"]`)
      // Components that drop data-section-id (h1, code-editor) left the old id
      // unresolvable before too; it stays unresolvable now.
      expect(el).toBe(expected)
      if (el) resolved++
    }
    expect(resolved).toBeGreaterThan(oldIds.length / 2)
  })
})

describe('current ids are stable under edits elsewhere', () => {
  const page = fixture('rechnen-mit-pfeilen.md')
  const insert = [
    '## Einstieg',
    '',
    '> [!tip] Vorwissen',
    '> Ein Vektor ist eine Verschiebung.',
    '',
    '<plugin src="informatikgarten/vektor-labor" views="vielfaches" axes="false" />',
    '',
  ].join('\n')

  it('inserting a section with a callout and the same plugin above keeps every later id', async () => {
    const before = await currentIds(page)
    const edited = page.replace('## Addition:', `${insert}\n## Addition:`)
    expect(edited).not.toBe(page)
    const after = await currentIds(edited)
    for (const id of before) expect(after).toContain(id)
  })

  it('removing the first callout keeps the ids of all callouts in later sections', async () => {
    const before = await currentIds(page)
    const edited = page.replace(/> \[!lernziele\][^\n]*\n(?:>[^\n]*\n)*/, '')
    expect(edited).not.toBe(page)
    const after = await currentIds(edited)
    const lost = before.filter(id => !after.includes(id))
    // Only the removed callout (first one under the h1) and its end sentinel disappear.
    expect(lost).toEqual(['callout@h1-@rechnen-mit-pfeilen#1', 'callout@h1-@rechnen-mit-pfeilen#1-end'])
  })

  it('renumbering headings keeps heading and block ids', async () => {
    const uebungen = fixture('uebungen-vektoren-als-pfeile.md')
    const before = await currentIds(uebungen)
    const edited = uebungen
      .replace('## 4 Vektorzüge', '## 5 Vektorzüge')
      .replace('## 3 Vielfache', '## 4 Vielfache')
      .replace('## 2 Addieren', '## 2 Gegenvektor und Nullvektor\n\nText.\n\n## 3 Addieren')
    const after = await currentIds(edited)
    for (const id of before) expect(after).toContain(id)
    expect(before).toContain('h2-@addieren-und-subtrahieren')
  })

  it('scopes h3 ids by their h2 and numbers repeats within a scope only', async () => {
    const ids = await currentIds(SYNTHETIC)
    expect(ids).toEqual(expect.arrayContaining([
      'h2-@basics',
      'h3-@basics/übungen',
      'h3-@more/übungen',
      'h2-@übungen',
      'h2-@übungen~2',
      'callout@h1-@title#1',
      'pre@h2-@basics#1',
      'editor@h2-@basics#1',
      'plugin-t-lab@h2-@basics#1',
      'plugin-t-lab@h2-@basics#2',
      'plugin@h2-@basics#1',
      'callout@h3-@basics/übungen#1',
      'solution@h3-@basics/übungen#1-end',
      'flex@h3-@more/übungen#1',
      'plugin-t-lab@h3-@more/übungen#1',
      'callout@h2-@übungen~2#1',
    ]))
  })
})
