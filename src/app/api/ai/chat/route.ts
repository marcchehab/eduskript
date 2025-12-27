import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { assembleSystemPrompt } from '@/lib/ai/prompts'
import type { ChatRequest, SkriptContext } from '@/lib/ai/types'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Simple in-memory rate limiting (use Redis in production for multi-instance)
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20 // requests per window
const RATE_WINDOW = 60 * 1000 // 1 minute

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const record = requestCounts.get(userId)

  if (!record || now > record.resetAt) {
    requestCounts.set(userId, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  if (record.count >= RATE_LIMIT) {
    return false
  }

  record.count++
  return true
}

export async function POST(request: Request) {
  try {
    // 1. Authentication
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // 2. Check API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: 'AI service not configured' },
        { status: 503 }
      )
    }

    // 3. Rate limiting
    if (!checkRateLimit(userId)) {
      return Response.json(
        { error: 'Rate limit exceeded. Please wait before sending more messages.' },
        { status: 429 }
      )
    }

    // 4. Parse request
    const body = (await request.json()) as ChatRequest
    const { skriptId, pageId, messages } = body

    if (!skriptId || !messages?.length) {
      return Response.json(
        { error: 'Missing required fields: skriptId and messages' },
        { status: 400 }
      )
    }

    // 5. Fetch skript with all data needed for context
    const skript = await prisma.skript.findUnique({
      where: { id: skriptId },
      include: {
        pages: { orderBy: { order: 'asc' } },
        authors: { include: { user: true } },
        files: { select: { id: true, name: true, contentType: true } },
      },
    })

    if (!skript) {
      return Response.json({ error: 'Skript not found' }, { status: 404 })
    }

    // 6. Check permissions
    const permissions = checkSkriptPermissions(userId, skript.authors)
    if (!permissions.canView) {
      return Response.json({ error: 'Access denied' }, { status: 403 })
    }

    // 7. Get organization and teacher prompts
    let orgPrompt: string | undefined
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiSystemPrompt: true,
        organizationMemberships: {
          include: { organization: true },
        },
      },
    })

    // Combine org prompt and teacher prompt
    const orgWithPrompt = user?.organizationMemberships.find(
      (m) => m.organization.aiSystemPrompt
    )?.organization

    const prompts: string[] = []
    if (orgWithPrompt?.aiSystemPrompt) {
      prompts.push(`## Organization Guidelines\n${orgWithPrompt.aiSystemPrompt}`)
    }
    if (user?.aiSystemPrompt) {
      prompts.push(`## Teacher Preferences\n${user.aiSystemPrompt}`)
    }
    if (prompts.length > 0) {
      orgPrompt = prompts.join('\n\n')
    }

    // 8. Build context
    const skriptContext: SkriptContext = {
      skript: {
        id: skript.id,
        title: skript.title,
        description: skript.description,
        slug: skript.slug,
        isPublished: skript.isPublished,
      },
      pages: skript.pages.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        content: p.content,
        order: p.order,
        isPublished: p.isPublished,
      })),
      files: skript.files,
      focusedPageId: pageId,
    }

    const systemPrompt = assembleSystemPrompt({
      orgPrompt,
      skriptContext,
    })

    // 9. Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    // 10. Create streaming response
    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()

    // Start Claude stream in background
    ;(async () => {
      try {
        const messageStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        })

        for await (const event of messageStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const data = JSON.stringify({
              type: 'content',
              content: event.delta.text,
            })
            await writer.write(encoder.encode(`data: ${data}\n\n`))
          }
        }

        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        )
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        console.error('Claude API error:', error)
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
    console.error('AI Chat error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
