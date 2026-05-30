/**
 * CodeMirror 6 extension for code highlighting
 *
 * Provides:
 * - StateField to track highlight decorations
 * - StateEffects to add/remove/set/clear highlights
 * - Automatic position updates when document changes
 *
 * Highlights are personal-only. Each decoration carries an arbitrary CSS
 * colour (from the toolbar highlighter pen) as an inline translucent
 * background via highlightBackground() — the same renderer used for prose
 * highlights — so any colour works and legacy named colours still resolve.
 *
 * ARCHITECTURE:
 * CodeMirror decorations can't store custom metadata, so we keep the id +
 * colour in data-* attributes and mirror positions in a module-level Map.
 *
 * POSITION TRACKING:
 * When text is edited, highlights adjust automatically via decorations.map().
 */

import { StateField, StateEffect, Prec } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { nanoid } from 'nanoid'
import type { HighlightColor, CodeHighlight } from '@/lib/userdata/types'
import { highlightBackground } from '@/lib/text-highlights/rendering'

// StateEffects for modifying highlights
export const addHighlight = StateEffect.define<{
  from: number
  to: number
  color: HighlightColor
  id?: string
}>()
export const removeHighlight = StateEffect.define<string>()  // by id
export const removeHighlightsInRange = StateEffect.define<{ from: number; to: number }>()
export const setHighlights = StateEffect.define<Array<{ from: number; to: number; color: HighlightColor; id: string }>>()
export const clearHighlights = StateEffect.define<void>()

// Store highlight metadata alongside decorations
interface HighlightMeta {
  id: string
  color: HighlightColor
}

/**
 * Create a decoration mark for a highlight. The colour is an arbitrary CSS
 * string rendered as an inline translucent background (no fixed palette).
 */
function createHighlightMark(color: HighlightColor, id: string) {
  return Decoration.mark({
    class: 'cm-code-highlight',
    attributes: {
      'data-highlight-id': id,
      'data-highlight-color': color,
      style: `background-color:${highlightBackground(color)};border-radius:2px`,
    },
  })
}

// Track highlight metadata in a Map (id -> {from, to, color}); decorations
// can't store custom data.
const highlightMetaMap = new Map<string, HighlightMeta & { from: number; to: number }>()

export const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },

  update(decorations, tr) {
    // Map existing decorations through document changes (auto position updates)
    decorations = decorations.map(tr.changes)

    const hasSetHighlights = tr.effects.some(e => e.is(setHighlights))

    if (tr.changes.length > 0 && !hasSetHighlights) {
      const updatedMeta = new Map<string, HighlightMeta & { from: number; to: number }>()
      highlightMetaMap.forEach((meta, id) => {
        const docLen = tr.changes.length
        if (meta.from >= docLen || meta.to > docLen) return
        const newFrom = tr.changes.mapPos(meta.from, 1)
        const newTo = tr.changes.mapPos(meta.to, -1)
        if (newTo > newFrom) {
          updatedMeta.set(id, { ...meta, from: newFrom, to: newTo })
        }
      })
      highlightMetaMap.clear()
      updatedMeta.forEach((v, k) => highlightMetaMap.set(k, v))
    }

    for (const effect of tr.effects) {
      if (effect.is(setHighlights)) {
        highlightMetaMap.clear()
        const marks = effect.value
          .filter(h => h.from < tr.state.doc.length && h.to <= tr.state.doc.length && h.to > h.from)
          .map(h => {
            highlightMetaMap.set(h.id, { id: h.id, color: h.color, from: h.from, to: h.to })
            return createHighlightMark(h.color, h.id).range(h.from, h.to)
          })
        decorations = Decoration.set(marks, true)
      }

      if (effect.is(addHighlight)) {
        const { from, to, color, id: providedId } = effect.value
        if (from < tr.state.doc.length && to <= tr.state.doc.length && to > from) {
          const id = providedId || nanoid()
          highlightMetaMap.set(id, { id, color, from, to })
          decorations = decorations.update({
            add: [createHighlightMark(color, id).range(from, to)]
          })
        }
      }

      if (effect.is(removeHighlight)) {
        const idToRemove = effect.value
        highlightMetaMap.delete(idToRemove)
        const ranges: { from: number; to: number; value: Decoration }[] = []
        decorations.between(0, tr.state.doc.length, (from, to, deco) => {
          const decoId = deco.spec.attributes?.['data-highlight-id']
          if (decoId !== idToRemove) {
            ranges.push({ from, to, value: deco })
          }
        })
        decorations = Decoration.set(ranges.map(r => r.value.range(r.from, r.to)), true)
      }

      if (effect.is(removeHighlightsInRange)) {
        const { from: rangeFrom, to: rangeTo } = effect.value
        const idsToRemove = new Set<string>()
        decorations.between(rangeFrom, rangeTo, (from, to, deco) => {
          const decoId = deco.spec.attributes?.['data-highlight-id']
          if (decoId) idsToRemove.add(decoId)
        })
        idsToRemove.forEach(id => highlightMetaMap.delete(id))

        const ranges: { from: number; to: number; value: Decoration }[] = []
        decorations.between(0, tr.state.doc.length, (from, to, deco) => {
          const decoId = deco.spec.attributes?.['data-highlight-id']
          if (!decoId || !idsToRemove.has(decoId)) {
            ranges.push({ from, to, value: deco })
          }
        })
        decorations = Decoration.set(ranges.map(r => r.value.range(r.from, r.to)), true)
      }

      if (effect.is(clearHighlights)) {
        highlightMetaMap.clear()
        decorations = Decoration.none
      }
    }

    return decorations
  },
})

// Provide decorations to the view
const highlightDecorations = EditorView.decorations.compute([highlightField], state => {
  return state.field(highlightField)
})

/**
 * Extract current highlights from the editor state (for persistence).
 * Reads from decorations (source of truth for what's rendered).
 */
export function extractHighlights(view: EditorView, fileIndex: number): CodeHighlight[] {
  const highlights: CodeHighlight[] = []
  const decorations = view.state.field(highlightField)

  decorations.between(0, view.state.doc.length, (from, to, deco) => {
    const id = deco.spec.attributes?.['data-highlight-id']
    const color = deco.spec.attributes?.['data-highlight-color'] as HighlightColor
    if (id && color) {
      highlights.push({ id, fileIndex, from, to, color, createdAt: Date.now() })
    }
  })

  return highlights
}

/**
 * Check if there's a highlight at the given position
 */
export function getHighlightAtPosition(view: EditorView, pos: number): { id: string; color: HighlightColor } | null {
  const decorations = view.state.field(highlightField)
  let result: { id: string; color: HighlightColor } | null = null
  decorations.between(pos, pos, (from, to, deco) => {
    const id = deco.spec.attributes?.['data-highlight-id']
    const color = deco.spec.attributes?.['data-highlight-color'] as HighlightColor
    if (id && color) result = { id, color }
  })
  return result
}

/**
 * Check if selection overlaps with any highlights
 */
export function getHighlightsInRange(view: EditorView, from: number, to: number): Array<{ id: string; color: HighlightColor }> {
  const decorations = view.state.field(highlightField)
  const results: Array<{ id: string; color: HighlightColor }> = []
  decorations.between(from, to, (_, __, deco) => {
    const id = deco.spec.attributes?.['data-highlight-id']
    const color = deco.spec.attributes?.['data-highlight-color'] as HighlightColor
    if (id && color) results.push({ id, color })
  })
  return results
}

/**
 * Combined extension for code highlighting.
 * Prec.high so highlights render above syntax highlighting.
 */
export function codeHighlighting() {
  return [
    highlightField,
    Prec.high(highlightDecorations),
  ]
}
