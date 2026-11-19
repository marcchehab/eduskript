/**
 * Where a student spacer goes in the rendered markdown.
 *
 * Spacers are injected after one direct child ("block") of `.markdown-content`
 * by annotation-layer.tsx. Until 2026-11-19 they stored only `afterBlockIndex`,
 * the index of that block among all blocks. Any block the teacher added above
 * (a paragraph, or a callout + its end sentinel) moved the spacer, plus the
 * strokes anchored to it, onto a different block.
 *
 * New spacers also store the nearest block at or above the target that has a
 * `data-section-id` (heading, callout, its `-end` sentinel, …; those ids are
 * scoped per heading section, see src/lib/rehype-plugins/heading-section-ids.ts)
 * and the target's offset from it, plus a text prefix of the target. Resolution:
 * 1. anchor block found → candidate = anchor + offset, limited to the anchor's
 *    heading section; if the text prefix doesn't match, the matching block in
 *    that section closest to the candidate wins.
 * 2. anchor block gone → the single block in the document with that text, else
 *    `afterBlockIndex` (the old behaviour).
 * Known limits: a block with no text (sentinel, image-only figure) can't be
 * re-found by text, so content inserted in the same section between the anchor
 * and such a target still shifts it. Renaming the scope heading renames block
 * ids in it (step 2 then applies). All O(blocks) per spacer.
 *
 * Legacy spacers (no anchor fields) resolve to `blocks[min(afterBlockIndex,
 * n-1)]` over {@link blockChildren}, which skips the blocks added to the
 * rendered markdown after 2026-11-19, so they land on the same block as before
 * on unchanged content.
 */
import type { Spacer } from '@/types/spacer'

/** Spacer divs and their end sentinels, injected by annotation-layer.tsx. */
export function isSpacerElement(el: Element): boolean {
  return el.hasAttribute('data-spacer-id') || el.hasAttribute('data-spacer-end')
}

// Blocks that did not exist when legacy afterBlockIndex values were stored:
// the `<solution>` end sentinel (heading-section-ids.ts, since 2026-11-19).
// Counting them would shift every legacy spacer below a solution by one block.
const POST_LEGACY_BLOCK_ID = /^solution@.+-end$/

function isPostLegacyBlock(el: Element): boolean {
  const id = el.getAttribute('data-section-id')
  return id !== null && POST_LEGACY_BLOCK_ID.test(id)
}

/** Content blocks of the markdown container, in the indexing `afterBlockIndex` uses. */
export function blockChildren(container: Element): Element[] {
  return Array.from(container.children).filter(el => !isSpacerElement(el) && !isPostLegacyBlock(el))
}

const TEXT_PREFIX_LEN = 60

export function blockText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_PREFIX_LEN)
}

const isHeadingBlock = (el: Element) => /^h[1-3]-/.test(el.getAttribute('data-section-id') ?? '')

export type SpacerAnchor = Required<Pick<Spacer, 'anchorSectionId' | 'anchorBlockOffset'>> & Pick<Spacer, 'anchorText'>

/** Anchor fields for a spacer placed after `blocks[index]`; null if out of range. */
export function computeSpacerAnchor(blocks: Element[], index: number): SpacerAnchor | null {
  const target = blocks[index]
  if (!target) return null
  let base = -1
  for (let i = index; i >= 0; i--) {
    if (blocks[i].hasAttribute('data-section-id')) { base = i; break }
  }
  const text = blockText(target)
  return {
    anchorSectionId: base >= 0 ? blocks[base].getAttribute('data-section-id')! : '',
    anchorBlockOffset: index - Math.max(base, 0),
    ...(text ? { anchorText: text } : {}),
  }
}

function legacyIndex(blocks: Element[], spacer: Pick<Spacer, 'afterBlockIndex'>): number {
  const i = Math.min(spacer.afterBlockIndex, blocks.length - 1)
  return i >= 0 ? i : -1
}

/** Index into `blocks` of the block the spacer goes after, or -1 when there are no blocks. */
export function resolveSpacerBlockIndex(blocks: Element[], spacer: Spacer): number {
  if (spacer.anchorSectionId === undefined || spacer.anchorBlockOffset === undefined) {
    return legacyIndex(blocks, spacer)
  }
  if (blocks.length === 0) return -1

  let base = 0
  if (spacer.anchorSectionId !== '') {
    base = blocks.findIndex(b => b.getAttribute('data-section-id') === spacer.anchorSectionId)
    if (base < 0) {
      if (spacer.anchorText) {
        const matches = blocks.flatMap((b, i) => (blockText(b) === spacer.anchorText ? [i] : []))
        if (matches.length === 1) return matches[0]
      }
      return legacyIndex(blocks, spacer)
    }
  }

  // The anchor's heading section: up to (excluding) the next heading block.
  let end = blocks.length
  for (let i = base + 1; i < blocks.length; i++) {
    if (isHeadingBlock(blocks[i])) { end = i; break }
  }
  const candidate = Math.min(base + Math.max(0, spacer.anchorBlockOffset), end - 1)
  if (spacer.anchorText && blockText(blocks[candidate]) !== spacer.anchorText) {
    let best = -1
    for (let i = base; i < end; i++) {
      if (blockText(blocks[i]) !== spacer.anchorText) continue
      if (best < 0 || Math.abs(i - candidate) < Math.abs(best - candidate)) best = i
    }
    if (best >= 0) return best
  }
  return candidate
}
