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
  const jsonData = JSON.stringify(data)
  const message = `event: ${event}\ndata: ${jsonData}\n\n`
  console.log(`[AI Edit] SSE sending event: ${event}, data size: ${jsonData.length} bytes`)
  controller.enqueue(encoder.encode(message))
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

  // Debug: Log content snippets to verify we have latest from DB
  console.log('[AI Edit] Page content snippets from DB:', skript.pages.map(p => ({
    title: p.title,
    contentPreview: p.content.slice(0, 100).replace(/\n/g, ' ')
  })))

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
          // Try to extract JSON even if AI included preamble text
          let jsonStr = planText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim()

          // If it doesn't start with {, try to find JSON object in the text
          if (!jsonStr.startsWith('{')) {
            const jsonMatch = planText.match(/\{[\s\S]*"edits"[\s\S]*\}/)
            if (jsonMatch) {
              jsonStr = jsonMatch[0]
              console.log('[AI Edit] Extracted JSON from preamble text')
            }
          }

          plan = JSON.parse(jsonStr)
        } catch (parseError) {
          // AI didn't return valid JSON - send the response as error
          console.error('[AI Edit] Failed to parse plan JSON:', parseError)
          const truncated = planText.length > 500 ? planText.slice(0, 500) + '...' : planText
          sendSSE(controller, 'error', { error: `Failed to parse AI response: ${truncated}` })
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

        // Log plan for debugging
        console.log(`[AI Edit] Plan received: ${plan.edits.length} pages to generate`, {
          skriptId,
          focusedPageId: pageId || 'none (skript-level edit)',
          pages: plan.edits.map(e => ({ title: e.pageTitle, isNew: e.isNew })),
        })

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

        console.log(`[AI Edit] Starting edit generation loop for ${plan.edits.length} edits`)

        for (let i = 0; i < plan.edits.length; i++) {
          const plannedEdit = plan.edits[i]
          console.log(`[AI Edit] Processing edit ${i + 1}/${plan.edits.length}:`, {
            pageId: plannedEdit.pageId,
            pageSlug: plannedEdit.pageSlug,
            pageTitle: plannedEdit.pageTitle,
            isNew: plannedEdit.isNew,
          })

          // Find the original page
          let originalPage = plannedEdit.pageId ? pageByIdMap.get(plannedEdit.pageId) : undefined
          if (!originalPage && plannedEdit.pageSlug) {
            originalPage = pageBySlugMap.get(plannedEdit.pageSlug)
          }
          console.log(`[AI Edit] Original page lookup: found=${!!originalPage}, slug=${originalPage?.slug}`)

          const isNew = plannedEdit.isNew === true || (!originalPage && plannedEdit.pageId === null)
          console.log(`[AI Edit] isNew=${isNew}, will use ${isNew && !originalPage ? 'NEW page' : 'EXISTING page'} branch`)
          const actualPageId = originalPage?.id ?? plannedEdit.pageId

          // Get original content
          const isFocusedPage = pageId && actualPageId === pageId
          const originalContent = (isFocusedPage && currentContent !== undefined)
            ? currentContent
            : (originalPage?.content ?? '')

          // For new pages, just use the summary as a starting point
          if (isNew && !originalPage) {
            // Generate content for new page
            console.log(`[AI Edit] Generating NEW page content for: ${plannedEdit.pageTitle}`)
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

            console.log(`[AI Edit] Calling Anthropic API for new page...`)
            const newPageMessage = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: newPagePrompt,
              messages: [{ role: 'user', content: `Create the content for the new page "${plannedEdit.pageTitle}". ${plannedEdit.summary}` }],
            })
            console.log(`[AI Edit] Anthropic API returned for new page, stop_reason: ${newPageMessage.stop_reason}`)

            const newContent = newPageMessage.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')

            console.log(`[AI Edit] Sending new page ${i + 1}/${plan.edits.length}: ${plannedEdit.pageTitle}`)
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
            console.log(`[AI Edit] Generating EDIT for existing page: ${originalPage?.title || plannedEdit.pageTitle}`)
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

            console.log(`[AI Edit] Calling Anthropic API for existing page edit...`)
            const editMessage = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: editPrompt,
              messages: [{ role: 'user', content: `Apply the following change to the page "${originalPage?.title || plannedEdit.pageTitle}": ${plannedEdit.summary}` }],
            })
            console.log(`[AI Edit] Anthropic API returned for edit, stop_reason: ${editMessage.stop_reason}`)

            const proposedContent = editMessage.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')

            console.log(`[AI Edit] Sending edit ${i + 1}/${plan.edits.length}: ${originalPage?.title || plannedEdit.pageTitle}`)
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

        console.log(`[AI Edit] Loop finished. Plan had ${plan.edits.length} edits`)
        // All done
        sendSSE(controller, 'complete', { success: true })
        console.log(`[AI Edit] Complete event sent`)
        controller.close()
      } catch (error) {
        console.error('[AI Edit] Streaming error:', error)
        // Log full error details
        if (error instanceof Error) {
          console.error('[AI Edit] Error name:', error.name)
          console.error('[AI Edit] Error message:', error.message)
          console.error('[AI Edit] Error stack:', error.stack)
        }
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
