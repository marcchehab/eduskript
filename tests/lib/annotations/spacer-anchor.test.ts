/**
 * Student spacer placement (src/lib/annotations/spacer-anchor.ts).
 * - Legacy spacers (afterBlockIndex only) must land on the same block as
 *   before on unchanged content, although heading-section-ids.ts now inserts
 *   extra `<solution>` end sentinels.
 * - New spacers (anchor fields) must stay on their block when the teacher
 *   inserts content above, in another section or the same one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import { toHtml } from 'hast-util-to-html'
import type { Root } from 'hast'
import { remarkPlugins } from '@/lib/markdown-compiler'
import { rehypeHeadingSectionIds } from '@/lib/rehype-plugins/heading-section-ids'
import { readLegacySectionIds } from '@/lib/annotations/reposition-strokes'
import {
  blockChildren,
  blockText,
  computeSpacerAnchor,
  resolveSpacerBlockIndex,
} from '@/lib/annotations/spacer-anchor'
import type { Spacer } from '@/types/spacer'
import { rehypeLegacyHeadingSectionIds } from '../fixtures/legacy-heading-section-ids'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../fixtures/sections', name), 'utf8')

async function toHast(md: string): Promise<Root> {
  md = md.replace(/<(plugin|excali|spacer)\b([^>]*?)\s*\/>/g, '<$1$2></$1>')
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
  return (await processor.run(processor.parse(md))) as Root
}

/** Markdown → `.markdown-content`-like container, ids from the given plugin. */
async function render(md: string, plugin: () => (tree: Root) => void = rehypeHeadingSectionIds): Promise<HTMLElement> {
  const tree = structuredClone(await toHast(md))
  plugin()(tree)
  const container = document.createElement('div')
  container.innerHTML = toHtml(tree)
  return container
}

/** The pre-2026-11-19 block list: children minus spacer elements. */
const oldBlocks = (container: HTMLElement) => Array.from(container.children).filter(
  el => !el.hasAttribute('data-spacer-id') && !el.hasAttribute('data-spacer-end'),
)
/** The pre-2026-11-19 placement. */
function oldTarget(container: HTMLElement, afterBlockIndex: number): Element | undefined {
  const blocks = oldBlocks(container)
  return blocks[Math.min(afterBlockIndex, blocks.length - 1)]
}

const spacer = (over: Partial<Spacer>): Spacer => ({ id: 's1', afterBlockIndex: 0, height: 80, pattern: 'blank', ...over })

/**
 * Same block in two renders: same tag, same text, and the same section id
 * or, for blocks without one, the same occurrence among the blocks of its
 * list with that tag + text.
 */
function sameBlock(a: Element | undefined, listA: Element[], b: Element | undefined, listB: Element[], mapId: (id: string) => string | undefined = id => id) {
  expect(a && b).toBeTruthy()
  expect(b!.tagName).toBe(a!.tagName)
  expect(blockText(b!)).toBe(blockText(a!))
  // Anchored blocks (incl. empty sentinels): same section id.
  const idA = a!.getAttribute('data-section-id')
  if (idA) return expect(b!.getAttribute('data-section-id')).toBe(mapId(idA))
  const nth = (el: Element, list: Element[]) => list.filter(c => c.tagName === el.tagName && blockText(c) === blockText(el)).indexOf(el)
  expect(nth(b!, listB)).toBe(nth(a!, listA))
}

describe.each([
  ['uebungen-vektoren-als-pfeile.md (with solutions)'],
  ['rechnen-mit-pfeilen.md'],
])('legacy spacers on unchanged content: %s', (name) => {
  it('every afterBlockIndex resolves to the block it resolved to before', async () => {
    const md = fixture(name.split(' ')[0])
    const before = await render(md, rehypeLegacyHeadingSectionIds)
    const after = await render(md)
    const blocks = blockChildren(after)
    const legacy = readLegacySectionIds(after)
    const n = blocks.length
    expect(n).toBe(oldBlocks(before).length)
    for (let i = 0; i < n + 2; i++) {
      const idx = resolveSpacerBlockIndex(blocks, spacer({ afterBlockIndex: i }))
      sameBlock(oldTarget(before, i), oldBlocks(before), blocks[idx], blocks, id => (id === 'paper-top' ? id : legacy.get(id)))
    }
  })
})

describe('the fixture with solutions really has extra blocks now', () => {
  it('solution end sentinels are direct children and skipped', async () => {
    const after = await render(fixture('uebungen-vektoren-als-pfeile.md'))
    const sentinels = Array.from(after.children).filter(el => /^solution@.+-end$/.test(el.getAttribute('data-section-id') ?? ''))
    expect(sentinels.length).toBeGreaterThanOrEqual(5)
    expect(blockChildren(after)).not.toContain(sentinels[0])
  })
})

describe('new spacers keep their block when the teacher edits', () => {
  const page = fixture('rechnen-mit-pfeilen.md')
  // Same edit as the QA repro (finding annotations-spacer-moves-to-other-block-after-teacher-edit).
  const anchorLine = 'Auf dieser Seite rechnen wir nur mit Pfeilen, ganz ohne Koordinaten.\n'
  const inserted = page.replace(anchorLine, anchorLine + '\n## Wiederholung: Was ist ein Vektor?\n\nEin Vektor beschreibt eine Verschiebung: Richtung und Länge.\n\n> [!tip] Merke\n> Gleich lange, gleich gerichtete Pfeile stellen denselben Vektor dar.\n')

  it('content inserted in another section: every block keeps its spacer', async () => {
    expect(inserted).not.toBe(page)
    const before = await render(page)
    const after = await render(inserted)
    const blocksBefore = blockChildren(before)
    const blocksAfter = blockChildren(after)
    let moved = 0
    blocksBefore.forEach((target, i) => {
      if (i === 0) return // paper-top
      const s = spacer({ afterBlockIndex: i, ...computeSpacerAnchor(blocksBefore, i) })
      sameBlock(target, blocksBefore, blocksAfter[resolveSpacerBlockIndex(blocksAfter, s)], blocksAfter)
      // The old placement would have moved it (4 blocks inserted above most of the page).
      if (oldTarget(after, i) !== blocksAfter[resolveSpacerBlockIndex(blocksAfter, s)]) moved++
    })
    expect(moved).toBeGreaterThan(blocksBefore.length / 2)
  })

  it('a paragraph inserted in the same section above the target: found by its text', async () => {
    const md = ['## A', '', 'one', '', 'two', '', 'three', '', '## B', '', 'four'].join('\n')
    const before = blockChildren(await render(md))
    const i = before.findIndex(b => b.textContent === 'three')
    const s = spacer({ afterBlockIndex: i, ...computeSpacerAnchor(before, i) })
    expect(s.anchorSectionId).toBe('h2-@a')
    expect(s.anchorBlockOffset).toBe(3)
    const after = blockChildren(await render(md.replace('one', 'zero\n\none')))
    expect(after[resolveSpacerBlockIndex(after, s)].textContent).toBe('three')
  })

  it('anchor section removed: falls back to a unique text match, then afterBlockIndex', async () => {
    const md = ['## A', '', 'one', '', '## B', '', 'two'].join('\n')
    const before = blockChildren(await render(md))
    const i = before.findIndex(b => b.textContent === 'two')
    const s = spacer({ afterBlockIndex: i, ...computeSpacerAnchor(before, i) })
    const renamed = blockChildren(await render(md.replace('## B', '## C')))
    expect(renamed[resolveSpacerBlockIndex(renamed, s)].textContent).toBe('two')
    const noText = { ...s, anchorText: undefined }
    expect(resolveSpacerBlockIndex(renamed, noText)).toBe(Math.min(i, renamed.length - 1))
  })

  it('no blocks → -1', () => {
    expect(resolveSpacerBlockIndex([], spacer({ anchorSectionId: '', anchorBlockOffset: 0 }))).toBe(-1)
    expect(resolveSpacerBlockIndex([], spacer({}))).toBe(-1)
  })
})
