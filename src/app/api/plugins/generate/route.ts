import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import OpenAI from 'openai'
import { PLUGIN_AUTHORING_PROMPT, parsePluginResponse } from '@/lib/ai/plugin-prompt'
import { openrouterRouting } from '@/lib/ai/openrouter'
import { templatePromptSection } from '@/lib/plugin-templates/server'

// glm-5.2 since 2026-10-05: in a 6-prompt × 8-model plugin bench (reasoning
// off) it was fastest (median 8 s) with the most polished results at
// ~4.6 ¢/plugin; deepseek-v4.1-flash was close at 0.7 ¢ (13 s). Bench runner
// was ad hoc (session scratchpad), results summarised in the commit message.
const CONTENT_MODEL = 'z-ai/glm-5.2'

// Upper bound on how long one Generate click may take, across all attempts.
// Each OpenAI call gets the remaining budget as its timeout and no new attempt
// starts once it is used up. Before this, 3 attempts ran back to back and a
// teacher waited 2.8 min (QA finding ai-plugin-generate-too-large-after-3min).
const TOTAL_BUDGET_MS = 120_000
// Below this many attempt-seconds left, another attempt is not worth starting.
const MIN_ATTEMPT_MS = 15_000
// finish_reason 'length' with less text than this means the model spent its
// max_tokens on reasoning and barely started the HTML; that is not "too large".
// Heuristic: a finished plugin is usually several thousand chars.
const NEARLY_EMPTY_CHARS = 4000

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TEMPLATES_INTRO = `## Templates (real maps and diagrams)

Never draw maps, country/canton outlines, anatomy or other real shapes yourself
when a template fits — you cannot reproduce real outlines. Insert a template with
<es-template name="SLUG"></es-template> where the SVG should appear; Eduskript
replaces the tag with the inline SVG before your script runs, so you can query it
right away. Inside the SVG:
- shapes: elements with data-id and data-name (German name), e.g. [data-id="ch"]
- points: circles with data-point-of="<shape id>" and data-name (e.g. the capital)
Style them with CSS (e.g. .es-shapes [data-id] { fill: ... }; hide .es-points circle
until revealed). Do not copy or redraw the SVG.
A template without points (e.g. no capitals) is still usable: add the markers
yourself at the centre of the shape (getBBox()) and say in the summary that the
positions are approximate. Missing points are NEVER a reason to ask for a
template — only missing outlines are. Shapes may sit inside groups with a transform, and
getBBox() is in the shape's own coordinates: append such markers to
shape.parentNode (not to the <svg> root), otherwise they end up off the map.
Shapes can be <path> or <g> elements; style both (e.g. .es-shapes [data-id],
.es-shapes [data-id] path). Only ask for a template when no listed one has the
needed outlines.

If the request needs real outlines (a map, a diagram of an organ, a building plan …)
and no template below has those OUTLINES, do NOT draw it: return ONLY
<!-- needs-template: <what SVG is needed, in the teacher's language, e.g. "eine Karte von Afrika mit Ländergrenzen"> -->

Available templates:`

const SYSTEM_PROMPT = `${PLUGIN_AUTHORING_PROMPT}

## Output Format

Return ONLY raw HTML content (the <style>, <div>, and <script> tags).
Do NOT wrap in JSON. Do NOT wrap in markdown fences. No explanations outside the HTML.

The FIRST line must be one HTML comment summarising what you built or changed,
in one short sentence, in the language of the teacher's request, without
technical jargon (the teacher may not know HTML):
<!-- summary: Die Karten sind jetzt grösser und farbiger. -->

If the request is too unclear to act on (e.g. "?", "make it better" with no
plugin yet), do NOT guess: return ONLY one comment with a short, friendly
question in the teacher's language, and no HTML:
<!-- question: Was für ein Spiel oder eine Übung schwebt Ihnen vor? -->`

/** Built per request: the template list grows when teachers add templates. */
async function systemPrompt(prompt: string, currentHtml: string) {
  return `${SYSTEM_PROMPT}\n\n${TEMPLATES_INTRO}\n${await templatePromptSection(prompt, currentHtml)}`
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPaidUser(session.user)) {
    return paidOnlyResponse('AI plugin generation is a paid feature.')
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  // Rate limiting (DB-backed)
  const recentJobs = await prisma.importJob.count({
    where: {
      userId: session.user.id,
      type: 'plugin-generate',
      createdAt: { gt: new Date(Date.now() - 60_000) },
    },
  })
  if (recentJobs >= 10) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please wait.' }, { status: 429 })
  }

  const { prompt, currentHtml } = await request.json()
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Track the request as a rate-limit marker. We reuse the import_jobs
  // table only because it gives us per-user time-bucketed counting; this
  // row is NOT a real import. Write it as terminal ('completed') so the
  // dashboard's active-import polling never picks it up — past attempts
  // wrote 'processing' and left these rows hanging forever, surfacing the
  // prompt text in the import-progress UI.
  await prisma.importJob.create({
    data: {
      userId: session.user.id,
      type: 'plugin-generate',
      status: 'completed',
      progress: 100,
      message: prompt.slice(0, 200),
      result: {},
      completedAt: new Date(),
    },
  })

  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://eduskript.org',
      'X-Title': 'Eduskript',
    },
    // Our loop below is the only retry; the SDK's own retries would multiply
    // the wait beyond TOTAL_BUDGET_MS.
    maxRetries: 0,
  })

  // Build user message: if there's existing HTML, this is an edit request
  let userMessage: string
  if (currentHtml?.trim()) {
    userMessage = `Here is the current plugin HTML:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nApply this change: ${prompt}`
  } else {
    userMessage = prompt
  }

  // The response is a stream of NDJSON events so the editor can show progress
  // during the 30–120 s a generation takes:
  //   { type: 'progress', phase: 'thinking' | 'writing', chars, attempt }
  //   { type: 'done', entryHtml, summary } | { type: 'question', question }
  //   { type: 'needs-template', need }  (no template fits: editor asks the teacher for an SVG)
  //   { type: 'error', error }
  // Errors before the stream starts (auth, paywall, rate limit, empty prompt)
  // stay plain JSON with an HTTP status. Closing the request (Cancel in the
  // editor) aborts the OpenRouter call.
  const system = await systemPrompt(prompt, currentHtml ?? '')
  const MAX_RETRIES = 3
  const deadline = Date.now() + TOTAL_BUDGET_MS
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')) } catch { /* client gone */ }
      }
      const fail = (error: string) => { send({ type: 'error', error }); controller.close() }
      let lastTruncatedLength = 0

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const remaining = deadline - Date.now()
        if (attempt > 1 && remaining < MIN_ATTEMPT_MS) {
          return fail(lastTruncatedLength > 0 ? truncatedMessage(lastTruncatedLength) : TIMEOUT_MESSAGE)
        }
        if (request.signal.aborted) return controller.close()
        try {
          const completion = await openai.chat.completions.create({
            // deepseek-v4.1-flash (successor of v4-flash, chosen 2026-08 over glm-5.2
            // for price at comparable German quality, see docs/ai-model-selection-eval.md).
            model: CONTENT_MODEL,
            max_tokens: 32000,
            stream: true,
            // Reasoning off: deepseek-v4.1-flash ignores `effort: 'low'` and
            // spent the whole budget thinking (2026-10-05, Europe-map prompt:
            // effort low → 56k reasoning chars, 72 s, cut off; disabled → 15 s,
            // 24k chars of finished HTML). Attempts truncated "at 0 chars" in
            // the dev log were this.
            ...({ reasoning: { enabled: false } } as Record<string, unknown>),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage },
            ],
            ...(openrouterRouting(CONTENT_MODEL) as Record<string, unknown>),
          }, { timeout: Math.max(remaining, 1_000), signal: request.signal })

          let text = ''
          let finishReason: string | null = null
          let lastSent = 0
          for await (const chunk of completion) {
            const choice = chunk.choices[0]
            const delta = choice?.delta as { content?: string | null; reasoning?: string | null } | undefined
            if (delta?.content) text += delta.content
            if (choice?.finish_reason) finishReason = choice.finish_reason
            const now = Date.now()
            if (now - lastSent > 400) {
              lastSent = now
              send({ type: 'progress', phase: text ? 'writing' : 'thinking', chars: text.length, attempt })
            }
          }

          if (finishReason === 'length') {
            console.warn(`Plugin generation attempt ${attempt}/${MAX_RETRIES} truncated at ${text.length} chars`)
            lastTruncatedLength = text.length
            if (attempt < MAX_RETRIES) continue
            return fail(truncatedMessage(text.length))
          }
          if (!text.trim()) {
            if (attempt < MAX_RETRIES) continue
            return fail('The AI returned no result. Please try again.')
          }

          const { html, summary, question, needsTemplate } = parsePluginResponse(text)
          if (needsTemplate) {
            send({ type: 'needs-template', need: needsTemplate })
          } else if (question) {
            send({ type: 'question', question })
          } else if (!html) {
            if (attempt < MAX_RETRIES) continue
            return fail('The AI returned no plugin. Please try again or describe it differently.')
          } else {
            send({ type: 'done', entryHtml: html, summary })
          }
          return controller.close()
        } catch (error) {
          if (request.signal.aborted) return controller.close()
          console.error(`Plugin generation attempt ${attempt} failed:`, error)
          if (error instanceof Error && error.name === 'APIConnectionTimeoutError') return fail(TIMEOUT_MESSAGE)
          if (attempt >= MAX_RETRIES) return fail('The AI is not reachable right now. Please try again in a moment.')
        }
      }
      fail('The AI is not reachable right now. Please try again in a moment.')
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

const TIMEOUT_MESSAGE = 'The AI took too long. Please try again, or describe less at once.'

// finish_reason 'length' on the last attempt. Only call it "too large" when
// the model actually wrote a lot; a nearly empty cut-off means it ran out of
// tokens while reasoning, and the fix is retrying, not simplifying.
function truncatedMessage(textLength: number) {
  return textLength < NEARLY_EMPTY_CHARS
    ? 'The AI stopped before finishing the plugin. Please try again.'
    : 'The plugin got too long for the AI. Try asking for fewer things at once.'
}
