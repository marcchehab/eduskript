/**
 * Student-facing AI feedback on handwritten/annotated work.
 *
 * POST { pageId, feedbackId?, image (data URL) }
 *
 * The server re-derives the teacher prompt + exercise section from the stored
 * page content (see feedback-context.ts) — the client never sends either, so
 * students can't tamper with the instructions. The image is the student's
 * work: either strokes rendered client-side or a pasted screenshot.
 *
 * Streams SSE events in the same { type: 'content' | 'error' | 'done' } shape
 * as /api/ai/chat.
 *
 * Model: OPENROUTER_VISION_MODEL env (the default text model on SambaNova has
 * no image input). OPENROUTER_PROVIDERS is deliberately NOT applied here —
 * that pin targets the text model's provider.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import { extractFeedbackContext } from '@/lib/ai/feedback-context'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Simple in-memory rate limiting (same limitation as /api/ai/chat:
// per-instance, use Redis if multi-instance abuse becomes a problem)
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10 // requests per window
const RATE_WINDOW = 60 * 1000

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const record = requestCounts.get(userId)
  if (!record || now > record.resetAt) {
    requestCounts.set(userId, { count: 1, resetAt: now + RATE_WINDOW })
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
- Be encouraging and concrete. Short paragraphs or a short list, not an essay.
- Use LaTeX ($...$) for mathematical expressions.
- Respond in the language of the exercise content.
- If the image contains no legible work, say so plainly and stop.`

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'AI service not configured' }, { status: 503 })
    }

    if (!checkRateLimit(userId)) {
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

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: {
        content: true,
        isPublished: true,
        authors: { include: { user: true } },
        skript: {
          select: {
            isPublished: true,
            authors: { include: { user: true } },
          },
        },
      },
    })
    if (!page) {
      return Response.json({ error: 'Page not found' }, { status: 404 })
    }

    // Published pages: any signed-in user may ask for feedback (students are
    // not page authors). Unpublished: authors/admin only.
    const isPublic = page.isPublished && page.skript.isPublished
    if (!isPublic) {
      const perms = checkPagePermissions(
        userId,
        page.authors,
        page.skript.authors,
        !!session.user.isAdmin
      )
      if (!perms.canView) {
        return Response.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const context = extractFeedbackContext(page.content, feedbackId, feedbackIndex)
    if (!context) {
      return Response.json(
        { error: 'No matching ai-feedback component on this page' },
        { status: 404 }
      )
    }

    const systemPrompt = context.prompt
      ? `${BASE_SYSTEM_PROMPT}\n\nTeacher's instructions for this exercise:\n${context.prompt}`
      : BASE_SYSTEM_PROMPT

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
          model: process.env.OPENROUTER_VISION_MODEL ?? 'google/gemini-2.5-flash',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `The exercise (course page section, markdown):\n\n${context.sectionMarkdown}\n\nThe image shows my work on this exercise. Please give me feedback.`,
                },
                { type: 'image_url', image_url: { url: image } },
              ],
            },
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
