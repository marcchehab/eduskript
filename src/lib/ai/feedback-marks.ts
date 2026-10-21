/**
 * Marks on the student's image (✓ / ✗ / ~ with a short comment), modelled on
 * the paper-exam correction tool.
 *
 * Two steps, because no single model on Infomaniak did both well (2026-10-21,
 * synthetic 5-part maths image, see the ai-feedback route):
 * 1. The feedback model (Qwen3.5-397B) ends its answer with a ```marks block,
 *    one JSON object per line: {"quote", "kind", "text"}. `quote` is the
 *    student's writing the mark refers to, copied as written. Asked for
 *    coordinates directly, it rounded to a ~50/1000 grid and drifted up to
 *    ~10 % of the image height.
 * 2. The locator model (Qwen3.8-27B) gets the image and the quotes and returns
 *    a 0–1000 box per quote. It hit 7/7 quotes within a few px in ~1.5 s, but
 *    as a grader it called 8 · 7 = 54 correct, so it only locates.
 *
 * The block comes after the text (see MARKS_PROMPT in the route for why); the
 * server locates once it closes and sends one `marks` event. The client hides
 * the block; the marks appear about 1 s after the text.
 *
 * @see src/app/api/ai/feedback/route.ts
 * @see src/components/markdown/ai-feedback-marks.tsx
 */

import type OpenAI from 'openai'

export type FeedbackMarkKind = 'correct' | 'wrong' | 'vague'

export interface FeedbackMark {
  /** Box around the referenced writing, 0–1 relative to image width/height. */
  x1: number
  y1: number
  x2: number
  y2: number
  kind: FeedbackMarkKind
  text: string
}

export interface QuotedMark {
  quote: string
  kind: FeedbackMarkKind
  text: string
}

export const MARKS_FENCE = '```marks'

const KINDS: readonly FeedbackMarkKind[] = ['correct', 'wrong', 'vague']

/**
 * The model sometimes joins several lines into one quote ("3x + 5 = 20 →
 * 3x = 15 → x = 3") although the prompt forbids it (2 of 3 multi-line photo
 * runs, 2026-10-21); the locator then boxes all lines and the dot lands
 * between them. Keep the last step, which is where an error usually shows.
 */
function lastStep(quote: string): string {
  const steps = quote.split(/\s*(?:→|⇒|⟹|=>|\n)\s*/).filter((s) => s.trim())
  return steps.length > 1 ? steps[steps.length - 1] : quote
}

/**
 * Index just past the block's closing fence, or -1 while it is still open.
 * The fence may close on the last JSON line itself (`{...}```), not only on a
 * line of its own.
 */
function blockEnd(answer: string, start: number): number {
  const close = answer.indexOf('```', start + MARKS_FENCE.length)
  return close < 0 ? -1 : close + 3
}

/**
 * Visible part of a (possibly still streaming) answer: the text without the
 * marks block. A fence only partly received ("``", "```ma") is hidden too.
 * `final`: the answer is complete, so a block that never closed ends at its
 * last JSON line and any text after it is kept (while streaming, everything
 * after an open fence is hidden, as it may still be marks).
 */
export function feedbackText(answer: string, final = false): string {
  const start = answer.indexOf(MARKS_FENCE)
  if (start >= 0) {
    const end = blockEnd(answer, start)
    if (end >= 0) return (answer.slice(0, start) + answer.slice(end)).trim()
    if (!final) return answer.slice(0, start).trimEnd()
    const rest = answer.slice(start + MARKS_FENCE.length).split('\n').filter((l) => !l.trim().startsWith('{'))
    return (answer.slice(0, start) + rest.join('\n')).trim()
  }
  const tail = answer.match(/`{1,3}m?a?r?k?s?$/)
  return tail ? answer.slice(0, tail.index).trimEnd() : answer
}

/** True once the marks block has been received completely. */
export function marksBlockClosed(answer: string): boolean {
  const start = answer.indexOf(MARKS_FENCE)
  return start >= 0 && blockEnd(answer, start) >= 0
}

/** Quoted marks from the received block; malformed lines are dropped. */
export function parseQuotedMarks(answer: string): QuotedMark[] {
  const start = answer.indexOf(MARKS_FENCE)
  if (start < 0) return []
  const end = blockEnd(answer, start)
  const marks: QuotedMark[] = []
  for (const line of answer.slice(start + MARKS_FENCE.length, end < 0 ? undefined : end).split('\n')) {
    const trimmed = line.trim().replace(/`+$/, '')
    if (!trimmed.startsWith('{')) continue
    try {
      const m = JSON.parse(trimmed) as Record<string, unknown>
      const kind = m.kind as FeedbackMarkKind
      if (typeof m.quote !== 'string' || !m.quote.trim() || !KINDS.includes(kind)) continue
      marks.push({ quote: lastStep(m.quote), kind, text: typeof m.text === 'string' ? m.text : '' })
    } catch {
      // malformed line
    }
  }
  return marks
}

const LOCATE_PROMPT = `Locate each quoted piece of writing in the image. Answer with one JSON object per line: {"i": <index>, "bbox_2d": [x1, y1, x2, y2]}, coordinates 0-1000 relative to the image width and height, tight boxes. Skip a quote you cannot find. No other text.`

/**
 * Step 2: one non-streamed call to the locator model. Quotes it cannot find
 * (or returns garbage for) are dropped, never placed at a guessed position.
 */
export async function locateMarks(
  client: OpenAI,
  model: string,
  extra: Record<string, unknown>,
  image: string,
  quoted: QuotedMark[],
): Promise<FeedbackMark[]> {
  if (quoted.length === 0) return []
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 1500,
    temperature: 0,
    messages: [
      { role: 'system', content: LOCATE_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: quoted.map((m, i) => `${i}: ${JSON.stringify(m.quote)}`).join('\n') },
        ],
      },
    ],
    ...extra,
  }, {
    // The client holds the feedback text until the marks arrive, so a hung
    // locator call must not hold it for the SDK's default 10 min.
    timeout: 15_000,
    maxRetries: 0,
  })
  const out: FeedbackMark[] = []
  const seen = new Set<number>()
  for (const line of (completion.choices[0]?.message?.content ?? '').split('\n')) {
    try {
      const m = JSON.parse(line.trim().replace(/,$/, '')) as { i?: unknown; bbox_2d?: unknown }
      const i = Number(m.i)
      const b = m.bbox_2d
      if (!Number.isInteger(i) || !quoted[i] || seen.has(i)) continue
      if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(Number(v)))) continue
      const [x1, y1, x2, y2] = b.map((v) => Math.min(1, Math.max(0, Number(v) / 1000)))
      if (x2 <= x1 || y2 <= y1) continue
      seen.add(i)
      out.push({ x1, y1, x2, y2, kind: quoted[i].kind, text: quoted[i].text })
    } catch {
      // not a JSON line
    }
  }
  return out
}
