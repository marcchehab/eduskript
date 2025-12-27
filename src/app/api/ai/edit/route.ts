import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { assembleEditPrompt, assembleSinglePageEditPrompt } from '@/lib/ai/prompts'
import type { EditRequest, SkriptContext } from '@/lib/ai/types'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120 // 2 minutes for large edit requests

// Rate limiting
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW = 60 * 1000

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const key = `edit:${userId}`
  const record = requestCounts.get(key)

  if (!record || now > record.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  if (record.count >= RATE_LIMIT) {
    return false
  }

  record.count++
  return true
}

// SSE helper to send events
function sendSSE(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

export async function POST(request: Request): Promise<Response> {
  // 1. Authentication
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // 2. Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ success: false, error: 'AI service not configured' }, { status: 503 })
  }

  // 3. Rate limiting
  if (!checkRateLimit(userId)) {
    return Response.json(
      { success: false, error: 'Rate limit exceeded. Please wait before requesting more edits.' },
      { status: 429 }
    )
  }

  // 4. Parse request
  const body = (await request.json()) as EditRequest & { currentContent?: string }
  const { skriptId, pageId, instruction, currentContent } = body

  if (!skriptId || !instruction?.trim()) {
    return Response.json(
      { success: false, error: 'Missing required fields: skriptId and instruction' },
      { status: 400 }
    )
  }

  // 5. Fetch skript
  const skript = await prisma.skript.findUnique({
    where: { id: skriptId },
    include: {
      pages: { orderBy: { order: 'asc' } },
      authors: { include: { user: true } },
      files: { select: { id: true, name: true, contentType: true } },
    },
  })

  if (!skript) {
    return Response.json({ success: false, error: 'Skript not found' }, { status: 404 })
  }

  // 6. Check permissions
  const permissions = checkSkriptPermissions(userId, skript.authors)
  if (!permissions.canEdit) {
    return Response.json({ success: false, error: 'Edit access denied' }, { status: 403 })
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

  // 8. Build context with page content map for later use
  const pageContentMap = new Map<string, string>()
  skript.pages.forEach((p) => {
    const content = (pageId && p.id === pageId && currentContent !== undefined)
      ? currentContent
      : p.content
    pageContentMap.set(p.id, content)
  })

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
      content: pageContentMap.get(p.id) || p.content,
      order: p.order,
      isPublished: p.isPublished,
    })),
    files: skript.files,
    focusedPageId: pageId,
  }

  // 9. Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        })

        // Phase 1: Get the edit plan
        const planPrompt = assembleEditPrompt({
          orgPrompt,
          skriptContext,
          planOnly: true, // New flag to just get the plan
        })

        const planMessage = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: planPrompt,
          messages: [{ role: 'user', content: instruction }],
        })

        const planText = planMessage.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')

        // Parse the plan
        let plan: {
          edits: Array<{
            pageId: string | null
            pageTitle: string
            pageSlug: string
            summary: string
            isNew?: boolean
          }>
          overallSummary: string
        }

        try {
          const jsonStr = planText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim()
          plan = JSON.parse(jsonStr)
        } catch {
          // AI didn't return valid JSON - send the response as error
          const truncated = planText.length > 500 ? planText.slice(0, 500) + '...' : planText
          sendSSE(controller, 'error', { error: truncated })
          controller.close()
          return
        }

        if (!plan.edits || plan.edits.length === 0) {
          sendSSE(controller, 'complete', {
            edits: [],
            overallSummary: plan.overallSummary || 'No changes needed',
          })
          controller.close()
          return
        }

        // Send the plan to client
        sendSSE(controller, 'plan', {
          totalEdits: plan.edits.length,
          overallSummary: plan.overallSummary,
          pages: plan.edits.map(e => ({
            pageId: e.pageId,
            pageTitle: e.pageTitle,
            pageSlug: e.pageSlug,
            summary: e.summary,
            isNew: e.isNew,
          })),
        })

        // Phase 2: Generate each edit
        const pageByIdMap = new Map(skript.pages.map(p => [p.id, p]))
        const pageBySlugMap = new Map(skript.pages.map(p => [p.slug, p]))

        for (let i = 0; i < plan.edits.length; i++) {
          const plannedEdit = plan.edits[i]

          // Find the original page
          let originalPage = plannedEdit.pageId ? pageByIdMap.get(plannedEdit.pageId) : undefined
          if (!originalPage && plannedEdit.pageSlug) {
            originalPage = pageBySlugMap.get(plannedEdit.pageSlug)
          }

          const isNew = plannedEdit.isNew === true || (!originalPage && plannedEdit.pageId === null)
          const actualPageId = originalPage?.id ?? plannedEdit.pageId

          // Get original content
          const isFocusedPage = pageId && actualPageId === pageId
          const originalContent = (isFocusedPage && currentContent !== undefined)
            ? currentContent
            : (originalPage?.content ?? '')

          // For new pages, just use the summary as a starting point
          if (isNew && !originalPage) {
            // Generate content for new page
            const newPagePrompt = assembleSinglePageEditPrompt({
              orgPrompt,
              skriptContext,
              targetPage: {
                title: plannedEdit.pageTitle,
                slug: plannedEdit.pageSlug,
                isNew: true,
              },
              editSummary: plannedEdit.summary,
              instruction,
            })

            const newPageMessage = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: newPagePrompt,
              messages: [{ role: 'user', content: `Create the content for the new page "${plannedEdit.pageTitle}". ${plannedEdit.summary}` }],
            })

            const newContent = newPageMessage.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')

            sendSSE(controller, 'edit', {
              index: i,
              pageId: null,
              pageTitle: plannedEdit.pageTitle,
              pageSlug: plannedEdit.pageSlug,
              originalContent: '',
              proposedContent: newContent.trim(),
              summary: plannedEdit.summary,
              isNew: true,
            })
          } else {
            // Generate edit for existing page
            const editPrompt = assembleSinglePageEditPrompt({
              orgPrompt,
              skriptContext,
              targetPage: {
                id: actualPageId!,
                title: originalPage?.title || plannedEdit.pageTitle,
                slug: originalPage?.slug || plannedEdit.pageSlug,
                content: originalContent,
                isNew: false,
              },
              editSummary: plannedEdit.summary,
              instruction,
            })

            const editMessage = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: editPrompt,
              messages: [{ role: 'user', content: `Apply the following change to the page "${originalPage?.title || plannedEdit.pageTitle}": ${plannedEdit.summary}` }],
            })

            const proposedContent = editMessage.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')

            sendSSE(controller, 'edit', {
              index: i,
              pageId: actualPageId,
              pageTitle: originalPage?.title || plannedEdit.pageTitle,
              pageSlug: originalPage?.slug || plannedEdit.pageSlug,
              originalContent,
              proposedContent: proposedContent.trim(),
              summary: plannedEdit.summary,
              isNew: false,
            })
          }
        }

        // All done
        sendSSE(controller, 'complete', { success: true })
        controller.close()
      } catch (error) {
        console.error('AI Edit streaming error:', error)
        sendSSE(controller, 'error', { error: 'Internal server error' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
