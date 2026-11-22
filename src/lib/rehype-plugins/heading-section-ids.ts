import { visit, SKIP } from 'unist-util-visit'
import type { Root, Element } from 'hast'

import { LEGACY_SECTION_IDS_ATTR } from '@/lib/annotations/reposition-strokes'

// "2 Addieren", "2. Addieren", "2.1 Addieren", "2) Addieren" → "Addieren".
// Requires whitespace after the number, so "2024" or "3D-Druck" stay as they are.
const LEADING_NUMBER = /^\s*\d+(?:\.\d+)*[.)]?\s+/

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Heading slug for the current section ids: like rehype-slug's, but without a
 * leading section number (renumbering headings must not change ids). Keeps
 * only letters, digits, `_` and `-`, so it never contains `@`, `#`, `/` or `~`,
 * the separators of the id format below. Falls back to the full text when
 * the text is only a number.
 */
export function stableHeadingSlug(text: string): string {
  return slugify(text.replace(LEADING_NUMBER, '')) || slugify(text)
}

/**
 * Rehype plugin to add data-section-id attributes to elements for annotation alignment.
 *
 * Tracks:
 * - h1, h2, h3 headings
 * - pre (code blocks)
 * - code-editor (interactive editors) - dynamic height due to console output
 * - plugin (iframe plugins) - dynamic height due to iframe auto-resize
 * - blockquote.callout (callouts) - dynamic height when collapsed/expanded
 * - figure (images)
 * - table (tables)
 * - flex (side-by-side layout container) - subsumes its descendants
 * - solution - end sentinel only (see below)
 * - other top-level blocks: p, ul/ol, h4-h6, blockquote, div (`p@<scope>#n`,
 *   `list@…`, `h4@…`, `quote@…`, `block@…`; no legacy id)
 *
 * ID FORMAT (since 2026-11-19). New strokes store these:
 * - heading: `h2-@<slug>`; h3: `h3-@<h2 key>/<slug>` (scoped to the preceding
 *   h2, so "### Übungen" under different h2s never collide). `<slug>` drops a
 *   leading section number. A repeated key gets `~2`, `~3`, … in document order
 *   (the only order-dependent part: inserting a same-named heading in the same
 *   scope above shifts the later ones).
 * - other blocks: `<kind>@<scope>#<n>`, e.g. `callout@h2-@addieren#1`,
 *   `plugin-teacher-vektor-labor@h2-@addieren#2`. `<scope>` is the id of the
 *   nearest preceding h1-h3 (`top` before the first one); `<n>` counts that
 *   kind within the scope. Inserting or removing content in another section
 *   therefore leaves the id unchanged; inserting the same kind earlier in the
 *   SAME section still shifts it. Renaming the scope heading changes it.
 * - the `-end` sentinel: `<id>-end`. Block ids end in `#<n>`, so a sentinel id
 *   never equals another block id.
 * Heading ids keep the `h1-`/`h2-` prefix that ai-feedback.tsx selects on.
 *
 * LEGACY IDS (before 2026-11-19, still stored by most strokes): `h2-<rehype-slug
 * id>`, `callout-<n>` / `pre-<n>` / `editor-<n>` / `figure-<n>` / `table-<n>` /
 * `flex-<n>` / src-less `plugin-<n>` counted over the whole document,
 * `plugin-<src>[-<n>]` per src. They are generated exactly as before and put
 * into the {@link LEGACY_SECTION_IDS_ATTR} map on `paper-top` (legacy → current
 * id), so a stored legacy id resolves to the same element as before on
 * unchanged content. Legacy ids never contain `@`, so the two namespaces are
 * disjoint. `paper-top` is the same in both.
 *
 * `<flex>` is treated as a single section: it gets its own section ID and the
 * walker skips its subtree, so headings/callouts/etc. that sit side-by-side
 * inside a flex don't each spawn their own section. Without this, two siblings
 * laid out horizontally would produce two vertically-stacked sections in the
 * annotation model and strokes would anchor to the wrong column.
 *
 * Dynamic-height elements also get data-dynamic-height="true" so the client
 * can track both top and bottom positions, AND get a 0-height sibling
 * `<div data-section-id="${id}-end">` inserted right after them. The sibling
 * is what the per-section annotation portal anchors to: strokes drawn near
 * the bottom of a dynamic-height element get sectionId `${id}-end` (picked by
 * simple-canvas.tsx), and the sibling gives those strokes a real DOM anchor
 * that follows the element's bottom edge as it grows/shrinks.
 *
 * `<solution>` gets only the `-end` sentinel (it is collapsed on every load, so
 * strokes below an opened one used to float one solution-height too low). The
 * Solution component does not receive data-section-id (markdown-components.tsx
 * passes title/teacher/children only), so there is no top anchor. Skipped
 * inside `<p>` (a div there is invalid HTML).
 */
// Top-level blocks anchored by kind (see the last rule in the visitor).
const ROOT_BLOCK_KIND: Record<string, string> = {
  p: 'p', ul: 'list', ol: 'list', h4: 'h4', h5: 'h5', h6: 'h6', blockquote: 'quote', div: 'block',
}

export function rehypeHeadingSectionIds() {
  return (tree: Root) => {
    // Always-present synthetic "first section" at the top of the rendered
    // content. Anything drawn above the first real heading would otherwise
    // anchor to nothing (determineSectionFromY returns null → simple-canvas
    // stores sectionId='unknown' → renderer can't find a DOM element →
    // stroke silently disappears). With a paper-top sentinel at offsetY≈0,
    // every stroke has a valid anchor regardless of what headings the
    // markdown contains. ColorTitleHeading also strips data-section-id off
    // h1, so without this even pages WITH an h1 are vulnerable.
    const paperTop: Element = {
      type: 'element',
      tagName: 'div',
      properties: {
        'data-section-id': 'paper-top',
        'aria-hidden': 'true',
        style: 'height:0;pointer-events:none',
      },
      children: [],
    }
    tree.children.unshift(paperTop)

    // Legacy counters (document-wide, exactly as before 2026-11-19).
    const counters: Record<string, number> = {
      pre: 0,
      'code-editor': 0,
      plugin: 0,
      callout: 0,
      figure: 0,
      table: 0,
      flex: 0,
    }
    const pluginSeen: Record<string, number> = {}
    const legacyIds: Record<string, string> = {}

    // Current scheme state.
    let scope = 'top'
    let scopeCounts = new Map<string, number>()
    let h2Key: string | undefined
    const headingSeen = new Map<string, number>()
    const blockId = (kind: string) => {
      const n = (scopeCounts.get(kind) ?? 0) + 1
      scopeCounts.set(kind, n)
      return `${kind}@${scope}#${n}`
    }

    // Collect end-sentinel insertions during visit; apply after the walk so we
    // don't perturb traversal indices.
    const inserts: Array<{ parent: Element | Root; index: number; sectionId: string; legacyId?: string }> = []

    const anchor = (
      node: Element,
      sectionId: string,
      legacyId: string,
      index: number | undefined,
      parent: Element | Root | undefined,
      dynamic: boolean,
    ) => {
      node.properties['data-section-id'] = sectionId
      legacyIds[legacyId] = sectionId
      if (dynamic) {
        node.properties['data-dynamic-height'] = 'true'
        if (parent && typeof index === 'number') inserts.push({ parent, index, sectionId, legacyId })
      }
    }

    visit(tree, 'element', (node: Element, index, parent) => {
      if (node === paperTop) return
      node.properties = node.properties || {}
      const p = parent as Element | Root | undefined

      // Flex container: claims one section ID for the whole subtree and
      // SKIPs descendants so siblings inside don't each become a section.
      // Marked dynamic-height because callouts inside can fold/unfurl.
      if (node.tagName === 'flex') {
        anchor(node, blockId('flex'), `flex-${counters.flex++}`, index, p, true)
        return SKIP
      }

      // H1-H3 headings. No rehype-slug id → no anchor (as before), and the
      // heading does not open a scope.
      if (node.tagName === 'h1' || node.tagName === 'h2' || node.tagName === 'h3') {
        const headingId = node.properties?.id as string | undefined
        if (!headingId) return

        const headingText = extractText(node)
        const slug = stableHeadingSlug(headingText)
        const key = node.tagName === 'h3' && h2Key !== undefined ? `${h2Key}/${slug}` : slug
        const base = `${node.tagName}-@${key}`
        const n = (headingSeen.get(base) ?? 0) + 1
        headingSeen.set(base, n)
        const sectionId = n === 1 ? base : `${base}~${n}`
        if (node.tagName === 'h2') h2Key = n === 1 ? key : `${key}~${n}`
        if (node.tagName === 'h1') h2Key = undefined

        anchor(node, sectionId, `${node.tagName}-${headingId}`, index, p, false)
        node.properties['data-heading-text'] = headingText
        scope = sectionId
        scopeCounts = new Map()
        return
      }

      // Code blocks (pre elements, but not inside code-editor)
      if (node.tagName === 'pre') {
        anchor(node, blockId('pre'), `pre-${counters.pre++}`, index, p, false)
        return
      }

      // Interactive code editors (custom element). Console output can change height.
      if (node.tagName === 'code-editor') {
        anchor(node, blockId('editor'), `editor-${counters['code-editor']++}`, index, p, true)
        return
      }

      // Plugin iframes (custom element) - dynamic height due to iframe auto-resize.
      // Legacy ID from the src attribute: the same plugin embedded several times
      // got `-2`, `-3` … from its second occurrence on (before 2026-11-09 every
      // occurrence shared one ID; the first kept it).
      if (node.tagName === 'plugin') {
        const src = node.properties?.src as string | undefined
        let legacyId: string
        let kind: string
        if (src) {
          const base = `plugin-${src.replace(/[^a-zA-Z0-9-]/g, '-')}`
          const n = (pluginSeen[base] = (pluginSeen[base] ?? 0) + 1)
          legacyId = n === 1 ? base : `${base}-${n}`
          kind = base
        } else {
          legacyId = `plugin-${counters.plugin++}`
          kind = 'plugin'
        }
        anchor(node, blockId(kind), legacyId, index, p, true)
        return
      }

      // Callouts (blockquote with callout class). Collapsible.
      if (node.tagName === 'blockquote') {
        const classes = node.properties?.className
        const classArray = Array.isArray(classes) ? classes : [classes]
        if (classArray.some(c => String(c).includes('callout'))) {
          anchor(node, blockId('callout'), `callout-${counters.callout++}`, index, p, true)
          return
        }
      }

      // Figures (images wrapped in figure tags)
      if (node.tagName === 'figure') {
        anchor(node, blockId('figure'), `figure-${counters.figure++}`, index, p, false)
        return
      }

      // Tables
      if (node.tagName === 'table') {
        anchor(node, blockId('table'), `table-${counters.table++}`, index, p, false)
        return
      }

      // <solution>: end sentinel only, no legacy id (new since 2026-11-19).
      if (node.tagName === 'solution') {
        if (p && typeof index === 'number' && !(p.type === 'element' && p.tagName === 'p')) {
          inserts.push({ parent: p, index, sectionId: blockId('solution') })
        }
        return
      }

      // Other top-level blocks (since 2026-11-21, no legacy id): paragraphs,
      // lists, h4-h6, plain blockquotes, divs (display-math wrapper from
      // rehypeMathBlockWrapper, alignment divs). A stroke in a long text
      // section anchors to the block it is drawn on, not the heading, so a
      // different font size (text reflow) only moves it by the reflow inside
      // that one block. Only direct children of the root: blocks inside
      // callouts, lists or flex stay part of their container's anchor.
      // Existing strokes keep their stored anchor. No SKIP: figures, code
      // blocks etc. inside must still be visited, or their ids (and the
      // legacy counters) would change.
      if (p?.type === 'root' && ROOT_BLOCK_KIND[node.tagName]) {
        node.properties['data-section-id'] = blockId(ROOT_BLOCK_KIND[node.tagName])
        return
      }
    })

    // Apply end-sentinel insertions in reverse order so earlier indices stay valid.
    // Same parent + same index cannot happen (one insert per element).
    inserts.sort((a, b) => b.index - a.index)
    for (const { parent, index, sectionId, legacyId } of inserts) {
      const sentinel: Element = {
        type: 'element',
        tagName: 'div',
        properties: {
          'data-section-id': `${sectionId}-end`,
          'data-section-end': 'true',
          'aria-hidden': 'true',
          style: 'height:0;pointer-events:none',
        },
        children: [],
      }
      if (legacyId) legacyIds[`${legacyId}-end`] = `${sectionId}-end`
      parent.children.splice(index + 1, 0, sentinel)
    }

    if (Object.keys(legacyIds).length > 0) {
      paperTop.properties[LEGACY_SECTION_IDS_ATTR] = JSON.stringify(legacyIds)
    }
  }
}

/**
 * Extract text content from an element node
 */
function extractText(node: Element): string {
  let text = ''

  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'text') {
        text += child.value
      } else if (child.type === 'element') {
        text += extractText(child as Element)
      }
    }
  }

  return text
}
