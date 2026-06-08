/**
 * Enumerate the gradable components on an exam page by parsing its markdown,
 * in document order, so the grading table can list every question (with its
 * declared max points + a label) even before any student answers — and so the
 * aggregator knows the authoritative max from the teacher's current markdown.
 *
 * Runtime componentIds this must match (see quiz.tsx / code-editor/index.tsx):
 * - quiz:   `quiz-user-content-${id}` — rehype-sanitize clobbers the `id`
 *           attribute with its default `user-content-` prefix, so the quiz
 *           component sees `id="user-content-q1"`. (`data-*` attrs are NOT
 *           clobbered, so code editors are unaffected.)
 * - python: `python-check-${id}`    from a ```python-check for="<id>" points```
 *           block (its `for` is the editor's id). The python *score* lives under
 *           `python-check-<id>`, not `code-editor-<id>`.
 *
 * Limitation: only components with an explicit `id`/`for` are enumerated. When
 * an author omits the id, the runtime componentId is a client-side content hash
 * we can't reliably reproduce server-side, so those are skipped — the grading
 * UI should nudge authors to set ids. (The seeded FMS exam sets ids on all.)
 *
 * Related: [[score-component]], [[aggregate]].
 */

export type GradableKind = 'quiz' | 'python'

export interface GradableComponent {
  componentId: string
  kind: GradableKind
  /** Quiz subtype; undefined for python. */
  questionType?: 'single' | 'multiple' | 'text' | 'number' | 'range'
  /** Declared max points from the markdown, if the author set `points=`. */
  maxPoints?: number
  /** Human label for the table — nearest preceding heading, else the id. */
  label?: string
  /** python only: the assert block body (for re-running at grading time). */
  checkCode?: string
  /** python only: the editor's starter/default code (already given to the
   *  student) — so rubric generation doesn't credit pre-provided scaffolding. */
  starterCode?: string
}

// rehype-sanitize's defaultSchema clobbers `id`/`name` with this prefix to
// prevent DOM clobbering; markdown-compiler.ts keeps the default. So a question
// authored as id="q1" renders with id="user-content-q1".
const CLOBBER_PREFIX = 'user-content-'

function attr(tag: string, name: string): string | undefined {
  // Matches name="value" or name='value' (case-insensitive attribute name).
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? m[1] : undefined
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Parse gradable components in document order. We walk the content once,
 * tracking the most recent markdown heading as the label, and emit a component
 * whenever we hit a `<question>` tag or a ```python-check``` fence.
 */
export function parseGradableComponents(content: string): GradableComponent[] {
  const out: GradableComponent[] = []
  const lines = content.split('\n')
  let lastHeading: string | undefined
  let inFence = false
  let fenceInfo = '' // info string of the currently open ``` fence
  // While inside a ```python-check``` fence, accumulate its body (the asserts)
  // onto the component we just pushed, for re-running at grading time.
  let pendingCheck: GradableComponent | null = null
  let checkBody: string[] = []
  // The student editors' starter code, keyed by editor id (= the check's `for`),
  // captured so rubric generation can exclude pre-provided scaffolding. The
  // editor block precedes its python-check block, so the map is ready in time.
  const starterById = new Map<string, string>()
  let pendingEditorId: string | null = null
  let editorBody: string[] = []

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*```+\s*(.*)$/)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceInfo = fenceMatch[1].trim()
        if (/^python-check\b/i.test(fenceInfo)) {
          const forId = attr(fenceInfo, 'for') ?? attr(fenceInfo, 'id')
          if (forId) {
            pendingCheck = {
              componentId: `python-check-${forId}`,
              kind: 'python',
              maxPoints: num(attr(fenceInfo, 'points')),
              label: lastHeading,
              starterCode: starterById.get(forId),
            }
            checkBody = []
            out.push(pendingCheck)
          }
        } else if (/^python\b/i.test(fenceInfo) && /\beditor\b/i.test(fenceInfo)) {
          // Student code editor — accumulate its default body as starter code.
          pendingEditorId = attr(fenceInfo, 'id') ?? null
          editorBody = []
        }
      } else {
        // Closing fence — attach the accumulated check body / starter code.
        if (pendingCheck) {
          pendingCheck.checkCode = checkBody.join('\n')
          pendingCheck = null
        }
        if (pendingEditorId !== null) {
          starterById.set(pendingEditorId, editorBody.join('\n'))
          pendingEditorId = null
        }
        inFence = false
        fenceInfo = ''
      }
      continue
    }
    if (inFence) {
      if (pendingCheck) checkBody.push(line)
      else if (pendingEditorId !== null) editorBody.push(line)
      continue // ignore other fence content (incl. <question> in examples)
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/)
    if (headingMatch) {
      lastHeading = headingMatch[1].trim()
      continue
    }

    // <question ...> / <Question ...> opening tags (one per line in practice).
    const qMatch = line.match(/<question\b[^>]*>/i)
    if (qMatch) {
      const tag = qMatch[0]
      const id = attr(tag, 'id')
      if (id) {
        const type = (attr(tag, 'type') as GradableComponent['questionType']) ?? 'multiple'
        out.push({
          componentId: `quiz-${CLOBBER_PREFIX}${id}`,
          kind: 'quiz',
          questionType: type,
          maxPoints: num(attr(tag, 'points')),
          label: lastHeading,
        })
      }
    }
  }

  return out
}

/**
 * Return the markdown slice for the exercise SECTION that contains a component —
 * from the nearest h1/h2 heading at or before it to the next h1/h2 heading (or
 * EOF). Used to give the AI scorer only the relevant exercise instead of the
 * whole exam page.
 *
 * WHY: a reasoning model (minimax) handed the entire 13k-char exam can spiral on
 * a single ambiguous submission — chain-of-thought eats the whole token budget,
 * it emits EMPTY content, and the request then times out (the browser sees an
 * HTML 504, hence "JSON.parse: unexpected character at line 1 column 1"). The
 * trigger isn't size: the 9.7k "Teil 2" section scores cleanly in ~4s, but the
 * full page spirals because Part 1's nine "predict the exact output" programs
 * derail it. Scoping to the section drops that noise. Verified with
 * scripts/reasoning-probe.mjs.
 *
 * Boundary is h1/h2 — NOT every heading: a single exercise often spans several
 * h3 sub-parts and multiple editors that all need the shared exercise context,
 * so cutting at h3 would starve them. Headings inside ``` code fences (e.g. a
 * `# comment` in a python editor block) are ignored — they aren't markdown
 * headings.
 *
 * Returns null when the component can't be located (caller falls back to the
 * full page).
 */
export function extractComponentContext(content: string, componentId: string): string | null {
  // Recover the author-facing id (the `for`/`id` attr) from the componentId.
  const rawId = componentId.startsWith('python-check-')
    ? componentId.slice('python-check-'.length)
    : componentId.startsWith(`quiz-${CLOBBER_PREFIX}`)
      ? componentId.slice(`quiz-${CLOBBER_PREFIX}`.length)
      : null
  if (!rawId) return null

  const lines = content.split('\n')
  // Single forward pass, tracking ``` fence state, to find both the component's
  // anchor line and every h1/h2 heading OUTSIDE fences. Fence-awareness matters:
  // a `# comment` inside a python editor block is NOT a markdown heading and must
  // not become a section boundary.
  let anchor = -1
  let inFence = false
  const h1h2: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(/^\s*```+\s*(.*)$/)
    if (fenceMatch) {
      const info = fenceMatch[1].trim()
      if (!inFence) {
        inFence = true
        if (anchor < 0) {
          const isCheck = /^python-check\b/i.test(info) && (attr(info, 'for') === rawId || attr(info, 'id') === rawId)
          const isEditor = /^python\b/i.test(info) && /\beditor\b/i.test(info) && attr(info, 'id') === rawId
          if (isCheck || isEditor) anchor = i
        }
      } else {
        inFence = false
      }
      continue
    }
    if (inFence) continue
    if (/^#{1,2}\s+/.test(lines[i])) h1h2.push(i)
    else if (anchor < 0) {
      const qMatch = lines[i].match(/<question\b[^>]*>/i)
      if (qMatch && attr(qMatch[0], 'id') === rawId) anchor = i
    }
  }
  if (anchor < 0) return null

  // Section start: nearest h1/h2 at or before the anchor (0 if the component
  // precedes any h1/h2 — keep the leading content rather than dropping it).
  // Section end: next h1/h2 strictly after start.
  let start = 0
  let end = lines.length
  for (const h of h1h2) {
    if (h <= anchor) start = h
    else { end = h; break }
  }
  return lines.slice(start, end).join('\n').trim() || null
}
