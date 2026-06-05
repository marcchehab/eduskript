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
            }
            checkBody = []
            out.push(pendingCheck)
          }
        }
      } else {
        // Closing fence — attach the accumulated check body, if any.
        if (pendingCheck) {
          pendingCheck.checkCode = checkBody.join('\n')
          pendingCheck = null
        }
        inFence = false
        fenceInfo = ''
      }
      continue
    }
    if (inFence) {
      if (pendingCheck) checkBody.push(line)
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
