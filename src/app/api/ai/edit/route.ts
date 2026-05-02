import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { assembleEditPrompt } from '@/lib/ai/prompts'
import type { EditRequest, SkriptContext } from '@/lib/ai/types'
import { parseJsonResponse, isValidEditPlan, type ParseJsonResponse } from '@/lib/ai/parse-json-response'
import { loadFrontPageContext } from '@/lib/ai/frontpage-context'
import { openrouterProviderRouting } from '@/lib/ai/openrouter'
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

  // 2. Paid-plan gate
  if (!isPaidUser(session.user)) {
    return paidOnlyResponse('AI editing is a paid feature.')
  }

  // 3. Check API key
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

  // 4. Parse request — exactly one of skriptId or frontPageId must be provided
  const body = (await request.json()) as EditRequest & { currentContent?: string }
  const { skriptId, pageId, frontPageId, instruction, currentContent } = body

  if (!instruction?.trim()) {
    return Response.json(
      { success: false, error: 'Missing required field: instruction' },
      { status: 400 }
    )
  }

  if ((!skriptId && !frontPageId) || (skriptId && frontPageId)) {
    return Response.json(
      { success: false, error: 'Provide exactly one of skriptId or frontPageId' },
      { status: 400 }
    )
  }

  // 5/6. Build SkriptContext — either real skript pages or the single virtual frontpage
  let skriptContext: SkriptContext
  if (frontPageId) {
    const ctx = await loadFrontPageContext({
      frontPageId,
      userId,
      isAdmin: !!session.user.isAdmin,
      currentContent,
    })
    if (!ctx.ok) {
      return Response.json({ success: false, error: ctx.error }, { status: ctx.status })
    }
    skriptContext = ctx.skriptContext

    // Cancel any other active frontpage-mode jobs for this user+frontpage
    await prisma.importJob.updateMany({
      where: {
        userId,
        type: 'ai-edit',
        status: { in: ['pending', 'processing'] },
        result: { path: ['frontPageId'], equals: frontPageId },
      },
      data: { status: 'cancelled' },
    })
  } else {
    const skript = await prisma.skript.findUnique({
      where: { id: skriptId! },
      include: {
        pages: { orderBy: { order: 'asc' } },
        authors: { include: { user: true } },
        files: { select: { id: true, name: true, contentType: true } },
      },
    })

    if (!skript) {
      return Response.json({ success: false, error: 'Skript not found' }, { status: 404 })
    }

    const permissions = checkSkriptPermissions(userId, skript.authors, undefined, !!session.user.isAdmin)
    if (!permissions.canEdit) {
      return Response.json({ success: false, error: 'Edit access denied' }, { status: 403 })
    }

    await prisma.importJob.updateMany({
      where: {
        userId,
        type: 'ai-edit',
        status: { in: ['pending', 'processing'] },
        result: { path: ['skriptId'], equals: skriptId! },
      },
      data: { status: 'cancelled' },
    })

    const pageContentMap = new Map<string, string>()
    skript.pages.forEach((p) => {
      const content = (pageId && p.id === pageId && currentContent !== undefined)
        ? currentContent
        : p.content
      pageContentMap.set(p.id, content)
    })

    skriptContext = {
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
  }

  // Plan generation: skript mode asks the AI to plan edits across pages;
  // frontpage mode is trivially one edit and we synthesize the plan locally to
  // avoid an unnecessary AI round-trip.
  let parseResult: ParseJsonResponse<{ edits: Array<{ pageId: string | null; pageTitle: string; pageSlug: string; summary: string; isNew?: boolean }>; overallSummary: string }> | undefined
  let lastPlanText = ''
  let planData: { edits: Array<{ pageId: string | null; pageTitle: string; pageSlug: string; summary: string; isNew?: boolean }>; overallSummary: string }

  if (frontPageId) {
    planData = {
      overallSummary: instruction.length > 120 ? `${instruction.slice(0, 117)}…` : instruction,
      edits: [{
        pageId: frontPageId,
        pageTitle: 'Front Page',
        pageSlug: 'frontpage',
        summary: instruction,
        isNew: false,
      }],
    }
  } else {
    // Skript mode: load org/user custom prompts, then ask the AI for a plan.
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
    })

    let orgPrompt: string | undefined
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiSystemPrompt: true,
        organizationMemberships: { include: { organization: true } },
      },
    })

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

    const planPrompt = assembleEditPrompt({
      orgPrompt,
      skriptContext,
      planOnly: true,
    })

    const MAX_PLAN_RETRIES = 3

    for (let attempt = 1; attempt <= MAX_PLAN_RETRIES; attempt++) {
      const planMessage = await openai.chat.completions.create({
        model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
        max_tokens: 8192,
        messages: [{ role: 'system', content: planPrompt }, { role: 'user', content: instruction }],
        // OpenRouter-specific: pin preferred providers via OPENROUTER_PROVIDERS env.
        // Field is unknown to the OpenAI SDK types but forwarded in the body.
        ...(openrouterProviderRouting() as Record<string, unknown>),
      })

      lastPlanText = planMessage.choices[0]?.message?.content ?? ''
      const finishReason = planMessage.choices[0]?.finish_reason

      log(`Plan attempt ${attempt}/${MAX_PLAN_RETRIES}, length: ${lastPlanText.length}, finish_reason: ${finishReason}`)

      if (finishReason === 'length') {
        log(`Plan attempt ${attempt} truncated at ${lastPlanText.length} chars, retrying...`)
        parseResult = { success: false, error: 'Response truncated', fullResponse: lastPlanText }
        continue
      }

      if (lastPlanText.length > 0) {
        log('Plan response preview:', lastPlanText.slice(0, 300))
      }

      parseResult = parseJsonResponse(lastPlanText, isValidEditPlan)

      if (parseResult.success) break

      const failReason = lastPlanText.length === 0
        ? 'empty response'
        : !parseResult.success ? `parse error: ${parseResult.error}` : 'unknown'
      log(`Plan attempt ${attempt} failed: ${failReason}`)

      if (attempt >= MAX_PLAN_RETRIES) {
        log('All plan attempts exhausted, last response:', lastPlanText.slice(0, 500))
      }
    }

    if (!parseResult || !parseResult.success) {
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

    planData = parseResult.data

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
  }

  // Build the persisted plan
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

  // Job carries either skriptId (multi-page mode) or frontPageId (single-page mode).
  // The generate route branches on which one is present.
  const jobResult = {
    skriptId: skriptId ?? null,
    frontPageId: frontPageId ?? null,
    instruction,
    focusedPageId: frontPageId ?? pageId ?? null,
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

  // Overflow info only exists when the AI was actually asked to plan (skript mode)
  // and the response was successfully parsed (success branch carries overflow fields).
  const overflowBefore = parseResult?.success ? parseResult.overflowBefore : undefined
  const overflowAfter = parseResult?.success ? parseResult.overflowAfter : undefined
  const fullResponse = parseResult?.success && (parseResult.overflowBefore || parseResult.overflowAfter)
    ? parseResult.fullResponse
    : undefined

  return Response.json({
    success: true,
    jobId: job.id,
    plan,
    overflowBefore,
    overflowAfter,
    fullResponse,
  })
}
