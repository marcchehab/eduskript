import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { assembleEditPrompt } from '@/lib/ai/prompts'
import type { EditRequest, SkriptContext } from '@/lib/ai/types'
import { parseJsonResponse, isValidEditPlan, type ParseJsonResponse } from '@/lib/ai/parse-json-response'
import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/ai/edit — Create job + generate plan.
 * Returns JSON { jobId, plan } instead of an SSE stream.
 * Each page edit is handled by a separate /api/ai/edit/[jobId]/generate request.
 */
export async function POST(request: Request): Promise<Response> {
  // 1. Authentication
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // 2. Check API key
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ success: false, error: 'AI service not configured' }, { status: 503 })
  }

  // 3. DB-backed rate limiting (survives deploys, unlike in-memory Map)
  const recentJobs = await prisma.importJob.count({
    where: {
      userId,
      type: 'ai-edit',
      createdAt: { gt: new Date(Date.now() - 60_000) },
    },
  })
  if (recentJobs >= 10) {
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
  const permissions = checkSkriptPermissions(userId, skript.authors, undefined, !!session.user.isAdmin)
  if (!permissions.canEdit) {
    return Response.json({ success: false, error: 'Edit access denied' }, { status: 403 })
  }

  // 7. Cancel any existing active ai-edit jobs for this user+skript
  await prisma.importJob.updateMany({
    where: {
      userId,
      type: 'ai-edit',
      status: { in: ['pending', 'processing'] },
      result: { path: ['skriptId'], equals: skriptId },
    },
    data: { status: 'cancelled' },
  })

  // 8. Build context
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

  // 9. Get the edit plan from AI (with retry)
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })

  // Organization prompt placeholder
  const orgPrompt: string | undefined = undefined

  const planPrompt = assembleEditPrompt({
    orgPrompt,
    skriptContext,
    planOnly: true,
  })

  const MAX_PLAN_RETRIES = 3
  let parseResult: ParseJsonResponse<{ edits: Array<{ pageId: string | null; pageTitle: string; pageSlug: string; summary: string; isNew?: boolean }>; overallSummary: string }> | undefined
  let lastPlanText = ''

  for (let attempt = 1; attempt <= MAX_PLAN_RETRIES; attempt++) {
    const planMessage = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
      max_tokens: 2048,
      messages: [{ role: 'system', content: planPrompt }, { role: 'user', content: instruction }],
    })

    lastPlanText = planMessage.choices[0]?.message?.content ?? ''

    log(`Plan attempt ${attempt}/${MAX_PLAN_RETRIES}, response length: ${lastPlanText.length}`)

    parseResult = parseJsonResponse(lastPlanText, isValidEditPlan)

    if (parseResult.success) break

    if (attempt < MAX_PLAN_RETRIES) {
      log(`Plan attempt ${attempt} failed (${lastPlanText.length === 0 ? 'empty response' : 'invalid JSON'}), retrying...`)
    }
  }

  // 10. Handle plan failure — no job created
  if (!parseResult || !parseResult.success) {
    log('All plan attempts failed')
    return Response.json({
      success: true,
      jobId: null,
      plan: {
        totalEdits: 0,
        overallSummary: 'The AI provided an explanation instead of edit suggestions.',
        pages: [],
      },
      aiMessage: (parseResult && !parseResult.success ? parseResult.fullResponse : null) || lastPlanText || 'The AI returned an empty response. Please try again.',
    })
  }

  const planData = parseResult.data

  if (!planData.edits || planData.edits.length === 0) {
    return Response.json({
      success: true,
      jobId: null,
      plan: {
        totalEdits: 0,
        overallSummary: planData.overallSummary || 'No changes needed',
        pages: [],
      },
    })
  }

  // 11. Create ImportJob with plan
  const plan = {
    totalEdits: planData.edits.length,
    overallSummary: planData.overallSummary,
    pages: planData.edits.map(e => ({
      pageId: e.pageId,
      pageTitle: e.pageTitle,
      pageSlug: e.pageSlug,
      summary: e.summary,
      isNew: e.isNew,
    })),
  }

  const jobResult = {
    skriptId,
    instruction,
    focusedPageId: pageId || null,
    currentContent: currentContent || null,
    plan,
    completedEdits: [] as Array<Record<string, unknown>>,
    failedPages: [] as Array<{ pageIndex: number; error: string }>,
  }

  const job = await prisma.importJob.create({
    data: {
      userId,
      type: 'ai-edit',
      status: 'processing',
      progress: 0,
      message: `Planned ${plan.totalEdits} page edits`,
      result: jobResult,
    },
  })

  log(`Job created: ${job.id}, plan: ${plan.totalEdits} pages`)

  return Response.json({
    success: true,
    jobId: job.id,
    plan,
    // Include overflow info if present
    overflowBefore: parseResult.overflowBefore,
    overflowAfter: parseResult.overflowAfter,
    fullResponse: (parseResult.overflowBefore || parseResult.overflowAfter) ? parseResult.fullResponse : undefined,
  })
}
