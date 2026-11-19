/**
 * Orphaned strokes: stored strokes whose sectionId no longer resolves to a
 * live `[data-section-id]` element (the teacher removed/renamed that section,
 * or a legacy id doesn't exist in the edited content). SectionAnchoredStrokes
 * reports them; the active layer draws them at their stored paper coordinates
 * (annotation-layer.tsx fallback layer) and offers the student to keep them
 * there or delete them.
 */
import type { StrokeData } from '@/lib/indexeddb/annotations'
import { determineSectionFromY, type HeadingPosition } from './reposition-strokes'

/** Spacer id from a `spacer-<id>` / `spacer-<id>-end` section id, else null. */
function spacerIdOf(sectionId: string): string | null {
  const m = /^spacer-(.+?)(-end)?$/.exec(sectionId)
  return m ? m[1] : null
}

/**
 * Orphans worth telling the student about. Strokes on a spacer that is still
 * in the spacer data are excluded: that spacer is injected into the DOM after
 * the spacer data loads, so its strokes are orphans only for a moment.
 */
export function reportableOrphans<T extends { sectionId: string }>(orphans: T[], knownSpacerIds: Set<string>): T[] {
  return orphans.filter(s => {
    const spacerId = spacerIdOf(s.sectionId)
    return !(spacerId && knownSpacerIds.has(spacerId))
  })
}

/**
 * Re-anchors the strokes with the given ids to the section that currently
 * contains their first point (current section ids only, no legacy aliases).
 * Points are unchanged and `sectionOffsetY` is set to that section's offset,
 * so the stroke renders at the same paper position as the orphan fallback
 * drew it and from then on moves with that section. O(strokes × sections).
 */
export function reanchorStrokesInPlace(
  strokes: StrokeData[],
  ids: Set<string>,
  headingPositions: HeadingPosition[],
): StrokeData[] {
  return strokes.map(stroke => {
    if (!ids.has(stroke.id)) return stroke
    const y = stroke.points[0]?.y ?? stroke.avgY ?? 0
    const sectionId = determineSectionFromY(y, headingPositions)
    const entry = sectionId ? headingPositions.find(h => h.sectionId === sectionId && !h.legacy) : undefined
    if (!entry) return stroke
    return { ...stroke, sectionId: entry.sectionId, sectionOffsetY: entry.offsetY }
  })
}
