/**
 * Student-facing AI feedback on handwritten/annotated work.
 *
 * POST { pageId, feedbackId?, image (data URL) }
 *
 * The server re-derives the teacher prompt + exercise section from the stored
 * page content (see feedback-context.ts) — the client never sends either, so
 * students can't tamper with the instructions. The image is the student's
 * work: either strokes rendered client-side or a pasted screenshot. An
 * optional solution="..." file (Excalidraw drawing or image in the skript) is
 * loaded here and sent as a second image — see feedback-solution.ts.
 *
 * Streams SSE events in the same { type: 'content' | 'error' | 'done' } shape
 * as /api/ai/chat.
 *
 * Model: aiModel('feedback') (src/lib/ai/provider.ts), since 2026-10-07
 * Qwen3.5-397B on Infomaniak (Switzerland) without thinking — student work
 * stays in Switzerland. Needs a vision model. Earlier history (OpenRouter): flash-lite beat qwen/qwen3-vl-235b-a22b-instruct on
 * a handwritten-math A/B (2026-07-23: as accurate, 5-11x faster, didn't hand over
 * solutions). Replaced 2026-09-13: on a hand-drawn shortest-path stroke that runs
 * through a node label, flash-lite misread the path ~20-30% of runs (7-10/10);
 * 3.8-flash got 20/20 and followed "one or two sentences". Both were 6/6 on clean
 * synthetic right/wrong paths, so the gap is reading messy strokes. Cost: 3.8-flash
 * is $0.75/$3.75 per M tokens vs $0.30/$2.50, latency ~4-9s vs ~2s.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import { extractFeedbackContext } from '@/lib/ai/feedback-context'
import { loadSolutionImage } from '@/lib/ai/feedback-solution'
import { recordMetric } from '@/lib/metrics/buffer'
import { aiConfigured, aiModel } from '@/lib/ai/provider'
import { locateMarks, marksBlockClosed, parseMarksScore, parseQuotedMarks } from '@/lib/ai/feedback-marks'
import type OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Simple in-memory rate limiting (same limitation as /api/ai/chat:
// per-instance, use Redis if multi-instance abuse becomes a problem)
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10 // requests per window
const RATE_WINDOW = 60 * 1000

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const record = requestCounts.get(key)
  if (!record || now > record.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (record.count >= RATE_LIMIT) return false
  record.count++
  return true
}

// ~6MB of base64 ≈ 4.5MB image — far beyond a reasonable screenshot
const MAX_IMAGE_CHARS = 6_000_000
const IMAGE_DATA_URL_PREFIX_RE = /^data:image\/(png|jpeg|webp);base64,/
// Checked as "contains a non-base64 char" rather than one anchored [..]+$
// over the whole URL: that pattern threw "Maximum call stack size exceeded"
// in V8 on a ~5M-char JPEG photo (2026-10-21).
const NON_BASE64_RE = /[^A-Za-z0-9+/=]/
function isImageDataUrl(url: string): boolean {
  const prefix = url.match(IMAGE_DATA_URL_PREFIX_RE)
  return !!prefix && url.length > prefix[0].length && !NON_BASE64_RE.test(url.slice(prefix[0].length))
}

const BASE_SYSTEM_PROMPT = `You are a patient tutor reviewing a student's handwritten or annotated work on an exercise.

You receive:
1. The exercise as markdown (the section of the course page the student is working on).
2. An image of the student's work — handwriting, drawings, or markings.

Guidelines:
- First read the student's work carefully. If the handwriting is ambiguous, say what you read it as (briefly) so misreadings are visible.
- Give feedback on the student's approach and each step. Point out where an error occurs and why it is an error, but do NOT hand over the full correct solution unless the teacher's instructions say otherwise.
- If the student's answer is correct, say so plainly. Do not invent doubts, hint at a "possibly better" answer, or ask them to double-check work that is right.
- Be encouraging and concrete. Short paragraphs or a short list, not an essay.
- Use LaTeX ($...$) for mathematical expressions.
- Respond in the language of the exercise content.
- If the image contains no legible work, say so plainly and stop.`

// Marks on the student's image, step 1 of 2 (see src/lib/ai/feedback-marks.ts):
// the model quotes the writing, the locator model finds it. Appended after
// the teacher's instructions so their length/format rules don't drop it.
// Block LAST: written first, the marks came before the model's reasoning and
// sometimes contradicted its own text (✗ on an answer the text called right,
// 2 of 11 paste runs, 2026-10-21). Placeholders, not a concrete
// example mark: with an example, Qwen3.5 copied it and wrote only that one.
const MARKS_PROMPT = `After your feedback, always end with a block of marks on the student's work, even if the teacher limits the length of your feedback:

\`\`\`marks
{"quote": "<writing as on the image>", "kind": "correct|wrong|vague", "text": "<comment>"}
{"quote": "...", ...}
\`\`\`

- One JSON object per line.
- quote: the exact piece of the student's writing the mark refers to, copied as written: one line or less (one equation or step), never several lines joined. It is used to find the spot on the image, so copy it exactly, including wrong parts. For an error in a later step, quote that step.
- kind: "correct" for a correct step or answer, "wrong" for an error, "vague" for something unclear, incomplete or hard to read.
- text: a short comment addressed to the student, a few words, in the language of the exercise. The same rule about not revealing the solution applies.
- One mark for every part and every result, usually 3-8 marks. Check each step yourself before marking it. If there is no legible work, leave the block empty.
- Do not mention the marks in your feedback text.`

export async function POST(request: Request) {
  try {
    // Anonymous callers are allowed on published content (the landing pages
    // demo this component to logged-out teachers). Unpublished content still
    // needs a session with view permission. Rate limit keys on the user id,
    // or the client IP for anon — per-instance, so it caps a single visitor,
    // not global spend; restrict to logged-in users again if cost becomes a
    // problem.
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id ?? null
    const isAdmin = !!session?.user?.isAdmin
    const rateKey =
      userId ??
      `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'}`

    if (!aiConfigured('feedback')) {
      return Response.json({ error: 'AI service not configured' }, { status: 503 })
    }

    if (!checkRateLimit(rateKey)) {
      return Response.json(
        { error: 'Rate limit exceeded. Please wait a moment before asking again.' },
        { status: 429 }
      )
    }

    const body = (await request.json()) as {
      pageId?: string
      feedbackId?: string
      feedbackIndex?: number
      image?: string
    }
    const { pageId, feedbackId, feedbackIndex, image } = body

    if (!pageId || !image) {
      return Response.json(
        { error: 'Missing required fields: pageId and image' },
        { status: 400 }
      )
    }
    if (image.length > MAX_IMAGE_CHARS || !isImageDataUrl(image)) {
      return Response.json(
        { error: 'This image is too large or not a supported format. Try a smaller photo or a cropped screenshot.' },
        { status: 400 }
      )
    }

    // Resolve the content + site prompt behind `pageId`. Two kinds of id reach
    // this route: a Page id, or a FrontPage id — the site/org landing pages
    // mount the markdown renderer with `frontPage.id` as pageId (see
    // app/[domain]/page.tsx, app/org/[orgSlug]/page.tsx), and there is no Page
    // row for those. Same split as /api/pages/[id]/submissions.
    let content: string
    let sitePrompt: string | null | undefined
    // Files live per skript; frontpages have none, so solution="..." is
    // ignored there.
    let skriptId: string | null = null

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: {
        content: true,
        skriptId: true,
        isPublished: true,
        authors: { include: { user: true } },
        skript: {
          select: {
            isPublished: true,
            authors: { include: { user: true } },
            // Page → Skript → (first) Collection → Site. The site's
            // aiSystemPrompt (teacher voice/language) is folded into the
            // feedback prompt so student feedback matches the site's style.
            // A skript can sit in several collections; the first by order wins.
            collectionSkripts: {
              orderBy: { order: 'asc' },
              take: 1,
              select: { collection: { select: { site: { select: { aiSystemPrompt: true } } } } },
            },
          },
        },
      },
    })

    if (page) {
      // Published pages: anyone, signed in or not. Unpublished: authors/admin only.
      const isPublic = page.isPublished && page.skript.isPublished
      if (!isPublic) {
        if (!userId) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const perms = checkPagePermissions(userId, page.authors, page.skript.authors, isAdmin)
        if (!perms.canView) {
          return Response.json({ error: 'Access denied' }, { status: 403 })
        }
      }
      content = page.content
      skriptId = page.skriptId
      sitePrompt = page.skript.collectionSkripts[0]?.collection.site.aiSystemPrompt
    } else {
      const frontPage = await prisma.frontPage.findUnique({
        where: { id: pageId },
        select: {
          content: true,
          isPublished: true,
          site: { select: { userId: true, organizationId: true, aiSystemPrompt: true } },
        },
      })
      if (!frontPage) {
        return Response.json({ error: 'Page not found' }, { status: 404 })
      }
      // Unpublished frontpage: site owner, org owner/admin, or site admin only.
      if (!frontPage.isPublished && !isAdmin) {
        if (!userId) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const site = frontPage.site
        let allowed = site?.userId === userId
        if (!allowed && site?.organizationId) {
          const member = await prisma.organizationMember.findFirst({
            where: { organizationId: site.organizationId, userId, role: { in: ['owner', 'admin'] } },
            select: { userId: true },
          })
          allowed = !!member
        }
        if (!allowed) {
          return Response.json({ error: 'Access denied' }, { status: 403 })
        }
      }
      content = frontPage.content
      sitePrompt = frontPage.site?.aiSystemPrompt
    }

    const context = extractFeedbackContext(content, feedbackId, feedbackIndex)
    if (!context) {
      return Response.json(
        { error: 'No matching ai-feedback component on this page' },
        { status: 404 }
      )
    }

    // Layer the prompt: base tutor role → site voice/language (aiSystemPrompt,
    // shared with the authoring AI) → this exercise's teacher instructions.
    let systemPrompt = BASE_SYSTEM_PROMPT
    if (sitePrompt?.trim()) {
      systemPrompt += `\n\nSite style and language guidelines:\n${sitePrompt.trim()}`
    }
    if (context.prompt) {
      // Explicit precedence: without it flash-lite kept the base guidelines'
      // format (long per-step list) over the teacher's "one or two sentences",
      // and hedged on answers matching the teacher's stated solution.
      systemPrompt += `\n\nTeacher's instructions for this exercise. These override the guidelines above wherever they conflict (length, format, whether to reveal answers). Any solution stated here is authoritative: compare the student's work against it, and if it matches, confirm it as correct.\n${context.prompt}`
    }

    systemPrompt += `\n\n${MARKS_PROMPT}`
    if (context.points != null) {
      systemPrompt += `\n- Add one more line to the block: {"score": <points>}, the points the student earned out of ${context.points}. Do not mention the score in your feedback text.`
    }

    // A missing/unreadable solution file degrades to plain feedback rather
    // than failing the student's request (logged in loadSolutionImage).
    const solutionImage =
      context.solution && skriptId ? await loadSolutionImage(skriptId, context.solution) : null
    if (solutionImage) {
      systemPrompt += `\n\nYou also receive the teacher's reference solution as an image, marked as such. The student cannot see it. It is authoritative: compare the student's work against it, and if the work matches it in substance, confirm it as correct. Differences in drawing style, layout, size, or labelling that don't change the meaning are not errors. Don't mention that a reference image exists, and don't reveal its content beyond what the guidelines above allow.`
    }

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `The exercise (course page section, markdown):\n\n${context.sectionMarkdown}`,
      },
    ]
    if (solutionImage) {
      userContent.push(
        { type: 'text', text: "Teacher's reference solution (hidden from the student):" },
        { type: 'image_url', image_url: { url: solutionImage } }
      )
    }
    userContent.push(
      { type: 'text', text: 'My work on this exercise. Please give me feedback.' },
      { type: 'image_url', image_url: { url: image } }
    )

    const ai = aiModel('feedback')

    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]

    // Step 2 of the marks: locate the quotes, started once per request as soon
    // as the marks block is complete, in parallel with the rest of the text.
    // A failure costs only the marks; the text feedback is unaffected.
    let locating: Promise<void> | null = null
    const startLocating = (answer: string) => {
      if (locating || !marksBlockClosed(answer)) return
      const quoted = parseQuotedMarks(answer)
      // Sends a `marks` event (empty on failure).
      locating = (async () => {
        let marks: Awaited<ReturnType<typeof locateMarks>> = []
        try {
          const loc = aiModel('feedbackLocate')
          marks = await locateMarks(loc.client, loc.model, loc.extra, image, quoted)
        } catch (err) {
          console.warn('[ai-feedback] locating marks failed:', err)
        }
        const score = context.points != null ? parseMarksScore(answer, context.points) : null
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'marks', marks, ...(score != null ? { score } : {}) })}\n\n`))
      })()
    }

    // One streamed completion; forwards text as it arrives and returns it with
    // the finish reason. `before` is text from an earlier attempt that this one
    // continues, so the marks block is detected across both.
    const streamAttempt = async (attemptMessages: typeof messages, before = '') => {
      const aiStream = await ai.client.chat.completions.create({
        model: ai.model,
        // Gemini's thinking tokens count against max_tokens. At 2048 a
        // detailed drawing (reaction mechanism) used ~1960 on reasoning and
        // the answer was cut after one sentence. Measured 2026-10-01 with
        // effort 'low': reasoning 0–3000 tokens, answer 400–700 chars, and
        // the same error detection as default effort on maths/CS/chemistry
        // tasks. OpenRouter's reasoning.max_tokens was not enforced reliably
        // for Gemini (3700 against a 2048 cap), hence effort.
        max_tokens: 8192,
        // OpenRouter extension (Gemini reasoning), not in the OpenAI SDK types.
        ...(ai.provider === 'openrouter' ? { reasoning: { effort: 'low' } } : {}),
        messages: attemptMessages,
        stream: true,
        // Provider fields (Infomaniak: thinking off). Student work → Infomaniak only.
        ...ai.extra,
      })
      let text = ''
      let finishReason: string | null = null
      for await (const chunk of aiStream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason
        if (delta) {
          text += delta
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`))
          startLocating(before + text)
        }
      }
      return { text, finishReason }
    }

    ;(async () => {
      try {
        const first = await streamAttempt(messages)
        let answer = first.text
        if (first.finishReason === 'length') {
          // Cut off mid-answer. The student already sees the partial text, so
          // a retry would visibly start over; instead ask the model to carry
          // on and append to the same stream. Tested 2026-10-01: Gemini picks
          // up mid-sentence without repeating, with no reasoning on the second
          // call. One continuation only.
          recordMetric('ai_feedback_continued', 1)
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'continuing' })}\n\n`))
          const second = await streamAttempt([
            ...messages,
            { role: 'assistant', content: first.text },
            { role: 'user', content: 'Your reply was cut off. Continue exactly where it stopped, mid-sentence if needed. Do not repeat anything and do not add a preamble.' },
          ], first.text)
          answer += second.text
          if (second.finishReason === 'length') {
            recordMetric('ai_feedback_truncated', 1)
            console.warn(`[ai-feedback] answer still truncated after continuation (${ai.spec})`)
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'truncated' })}\n\n`))
          }
        }
        // Normally the block closed in the last chunks and locating runs; an
        // unclosed block is located now. Without any block, an empty marks
        // event is sent, so the client always gets one before 'done'.
        startLocating(answer + '\n```')
        if (locating) await locating
        else await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'marks', marks: [] })}\n\n`))
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('AI feedback OpenRouter error:', error)
        const data = JSON.stringify({ type: 'error', error: errorMessage })
        // Rejects if the client disconnected (stream already cancelled).
        await writer.write(encoder.encode(`data: ${data}\n\n`)).catch(() => {})
      } finally {
        await writer.close().catch(() => { /* already closed by client abort */ })
      }
    })()

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('AI feedback error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
