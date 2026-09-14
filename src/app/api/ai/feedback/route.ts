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
 * Model: OPENROUTER_VISION_MODEL env, falling back to google/gemini-3.8-flash
 * (the text-only chat/plan models have no image input, so vision needs its own
 * multimodal slug). History: flash-lite beat qwen/qwen3-vl-235b-a22b-instruct on
 * a handwritten-math A/B (2026-07-23: as accurate, 5-11x faster, didn't hand over
 * solutions). Replaced 2026-09-13: on a hand-drawn shortest-path stroke that runs
 * through a node label, flash-lite misread the path ~20-30% of runs (7-10/10);
 * 3.8-flash got 20/20 and followed "one or two sentences". Both were 6/6 on clean
 * synthetic right/wrong paths, so the gap is reading messy strokes. Cost: 3.8-flash
 * is $0.75/$3.75 per M tokens vs $0.30/$2.50, latency ~4-9s vs ~2s.
 * OPENROUTER_PROVIDERS is deliberately NOT applied here — that pin targets the
 * text model's provider.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import { extractFeedbackContext } from '@/lib/ai/feedback-context'
import { loadSolutionImage } from '@/lib/ai/feedback-solution'
import OpenAI from 'openai'

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
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

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

    if (!process.env.OPENROUTER_API_KEY) {
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
    if (image.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL_RE.test(image)) {
      return Response.json({ error: 'Invalid or oversized image' }, { status: 400 })
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

    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
    })

    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()

    ;(async () => {
      try {
        const aiStream = await openai.chat.completions.create({
          model: process.env.OPENROUTER_VISION_MODEL ?? 'google/gemini-3.8-flash',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          stream: true,
        })

        for await (const chunk of aiStream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) {
            const data = JSON.stringify({ type: 'content', content: text })
            await writer.write(encoder.encode(`data: ${data}\n\n`))
          }
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('AI feedback OpenRouter error:', error)
        const data = JSON.stringify({ type: 'error', error: errorMessage })
        await writer.write(encoder.encode(`data: ${data}\n\n`))
      } finally {
        await writer.close()
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
