import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assembleSinglePageEditPrompt } from '@/lib/ai/prompts'
import type { SkriptContext } from '@/lib/ai/types'
import { loadFrontPageContext } from '@/lib/ai/frontpage-context'
import { normalizeContent } from '@/lib/ai/normalize-content'
import { openrouterProviderRouting } from '@/lib/ai/openrouter'
import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface AiEditPlan {
  totalEdits: number
  overallSummary: string
  pages: Array<{
    pageId: string | null
    pageTitle: string
    pageSlug: string
    summary: string
    isNew?: boolean
  }>
}

interface AiEditJobResult {
  // Exactly one of skriptId or frontPageId is set, mirroring the shape stored
  // by /api/ai/edit POST.
  skriptId: string | null
  frontPageId: string | null
  instruction: string
  focusedPageId: string | null
  currentContent: string | null
  plan: AiEditPlan
  completedEdits: Array<Record<string, unknown>>
  failedPages: Array<{ pageIndex: number; error: string }>
}

/**
 * POST /api/ai/edit/[jobId]/generate — Generate one page edit.
 * Body: { pageIndex: number }
 * Returns { edit: PageEdit } on success, { error } on failure.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const { jobId } = await params

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'AI service not configured' }, { status: 503 })
  }

  const body = (await request.json()) as { pageIndex: number }
  const { pageIndex } = body

  if (typeof pageIndex !== 'number' || pageIndex < 0) {
    return Response.json({ error: 'Invalid pageIndex' }, { status: 400 })
  }

  // 1. Fetch and verify job
  const job = await prisma.importJob.findUnique({ where: { id: jobId } })

  if (!job || job.userId !== userId || job.type !== 'ai-edit') {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status === 'cancelled') {
    return Response.json({ error: 'Job was cancelled' }, { status: 409 })
  }

  const jobResult = job.result as unknown as AiEditJobResult
  if (!jobResult?.plan?.pages) {
    return Response.json({ error: 'Job has no plan' }, { status: 400 })
  }

  if (pageIndex >= jobResult.plan.pages.length) {
    return Response.json({ error: 'pageIndex out of range' }, { status: 400 })
  }

  const plannedEdit = jobResult.plan.pages[pageIndex]

  // 2. Build context — branch on job mode (skript vs frontpage).
  let skriptContext: SkriptContext
  let originalPage: { id: string; title: string; slug: string; content: string } | undefined
  let isNew: boolean
  let actualPageId: string | null
  let originalContent: string

  if (jobResult.frontPageId) {
    // Frontpage mode: re-permission and rebuild the single-page virtual context.
    const ctx = await loadFrontPageContext({
      frontPageId: jobResult.frontPageId,
      userId,
      isAdmin: !!session.user.isAdmin,
      currentContent: jobResult.currentContent,
    })
    if (!ctx.ok) {
      return Response.json({ error: ctx.error }, { status: ctx.status })
    }
    skriptContext = ctx.skriptContext
    originalContent = ctx.content
    originalPage = {
      id: jobResult.frontPageId,
      title: 'Front Page',
      slug: 'frontpage',
      content: originalContent,
    }
    isNew = false
    actualPageId = jobResult.frontPageId
  } else if (jobResult.skriptId) {
    const skript = await prisma.skript.findUnique({
      where: { id: jobResult.skriptId },
      include: {
        pages: { orderBy: { order: 'asc' } },
        files: { select: { id: true, name: true, contentType: true } },
      },
    })

    if (!skript) {
      return Response.json({ error: 'Skript not found' }, { status: 404 })
    }

    const pageContentMap = new Map<string, string>()
    skript.pages.forEach((p) => {
      const content = (jobResult.focusedPageId && p.id === jobResult.focusedPageId && jobResult.currentContent)
        ? jobResult.currentContent
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
      focusedPageId: jobResult.focusedPageId || undefined,
    }

    const pageByIdMap = new Map(skript.pages.map(p => [p.id, p]))
    const pageBySlugMap = new Map(skript.pages.map(p => [p.slug, p]))

    originalPage = plannedEdit.pageId ? pageByIdMap.get(plannedEdit.pageId) : undefined
    if (!originalPage && plannedEdit.pageSlug) {
      originalPage = pageBySlugMap.get(plannedEdit.pageSlug)
    }

    isNew = plannedEdit.isNew === true || (!originalPage && plannedEdit.pageId === null)
    actualPageId = originalPage?.id ?? plannedEdit.pageId

    const isFocusedPage = jobResult.focusedPageId && actualPageId === jobResult.focusedPageId
    originalContent = (isFocusedPage && jobResult.currentContent)
      ? jobResult.currentContent
      : (originalPage?.content ?? '')
  } else {
    return Response.json({ error: 'Job has neither skriptId nor frontPageId' }, { status: 400 })
  }

  // 4. Call AI
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })

  // Fetch user and organization custom AI prompts
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

  const orgWithPrompt = user?.organizationMemberships.find(
    (m) => m.organization.aiSystemPrompt
  )?.organization

  const customPrompts: string[] = []
  if (orgWithPrompt?.aiSystemPrompt) {
    customPrompts.push(`## Organization Guidelines\n${orgWithPrompt.aiSystemPrompt}`)
  }
  if (user?.aiSystemPrompt) {
    customPrompts.push(`## Teacher Preferences\n${user.aiSystemPrompt}`)
  }
  if (customPrompts.length > 0) {
    orgPrompt = customPrompts.join('\n\n')
  }

  try {
    let proposedContent: string

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
        instruction: jobResult.instruction,
      })

      const newPageMessage = await openai.chat.completions.create({
        model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
        max_tokens: 8192,
        messages: [
          { role: 'system', content: newPagePrompt },
          { role: 'user', content: `Create the content for the new page "${plannedEdit.pageTitle}". ${plannedEdit.summary}` },
        ],
        ...(openrouterProviderRouting() as Record<string, unknown>),
      })

      proposedContent = (newPageMessage.choices[0]?.message?.content ?? '').trim()
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
        instruction: jobResult.instruction,
      })

      const editMessage = await openai.chat.completions.create({
        model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
        max_tokens: 8192,
        messages: [
          { role: 'system', content: editPrompt },
          { role: 'user', content: `Apply the following change to the page "${originalPage?.title || plannedEdit.pageTitle}": ${plannedEdit.summary}` },
        ],
        ...(openrouterProviderRouting() as Record<string, unknown>),
      })

      proposedContent = (editMessage.choices[0]?.message?.content ?? '').trim()
    }

    // Strip markdown code fence wrapper if the model wrapped its response in one
    if (/^```(?:markdown)?\s*\n/i.test(proposedContent) && /\n```\s*$/.test(proposedContent)) {
      proposedContent = proposedContent.replace(/^```(?:markdown)?\s*\n/i, '').replace(/\n```\s*$/, '')
    }

    // Normalize whitespace, line endings, and unicode form so the merge view
    // doesn't show huge spurious diff chunks for cosmetic differences. Apply
    // the same normalization to BOTH sides so the diff baseline matches.
    proposedContent = normalizeContent(proposedContent)
    const normalizedOriginal = normalizeContent(isNew ? '' : originalContent)

    // 5. Build edit result
    const edit = {
      index: pageIndex,
      pageId: isNew ? null : actualPageId,
      pageTitle: originalPage?.title || plannedEdit.pageTitle,
      pageSlug: originalPage?.slug || plannedEdit.pageSlug,
      originalContent: normalizedOriginal,
      proposedContent,
      summary: plannedEdit.summary,
      isNew,
    }

    // 6. Atomically append to job result
    // Read fresh job state, append edit, write back
    const freshJob = await prisma.importJob.findUnique({ where: { id: jobId } })
    const freshResult = freshJob?.result as unknown as AiEditJobResult
    const completedEdits = [...(freshResult?.completedEdits ?? []), edit]
    const totalPages = freshResult?.plan?.pages?.length ?? 0
    const progress = totalPages > 0 ? Math.round((completedEdits.length / totalPages) * 100) : 0
    const allDone = completedEdits.length + (freshResult?.failedPages?.length ?? 0) >= totalPages

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        result: { ...freshResult, completedEdits },
        progress,
        status: allDone ? 'completed' : 'processing',
        message: `Generated ${completedEdits.length}/${totalPages} pages`,
        ...(allDone ? { completedAt: new Date() } : {}),
      },
    })

    log(`Job ${jobId}: page ${pageIndex + 1}/${totalPages} done (${plannedEdit.pageTitle})`)

    return Response.json({ success: true, edit })
  } catch (error) {
    log.error(`Job ${jobId}: page ${pageIndex} failed:`, error)

    // Record failure in job
    const freshJob = await prisma.importJob.findUnique({ where: { id: jobId } })
    const freshResult = freshJob?.result as unknown as AiEditJobResult
    const failedPages = [...(freshResult?.failedPages ?? []), {
      pageIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    }]
    const totalPages = freshResult?.plan?.pages?.length ?? 0
    const allDone = (freshResult?.completedEdits?.length ?? 0) + failedPages.length >= totalPages

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        result: { ...freshResult, failedPages },
        status: allDone ? 'completed' : 'processing',
        message: `${freshResult?.completedEdits?.length ?? 0}/${totalPages} pages, ${failedPages.length} failed`,
        ...(allDone ? { completedAt: new Date() } : {}),
      },
    })

    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate edit',
      pageIndex,
    }, { status: 500 })
  }
}
