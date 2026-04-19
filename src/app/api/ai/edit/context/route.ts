import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { formatSkriptContext, estimateTokenCount } from '@/lib/ai/context-builder'
import { loadFrontPageContext } from '@/lib/ai/frontpage-context'
import type { EditRequest, SkriptContext } from '@/lib/ai/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/ai/edit/context — return the skript-content context the AI
 * would see, formatted as a clean human-readable text dump.
 *
 * Used by the AI Edit modal's "Copy context" button so users can paste the
 * same context into their own external chatbot. Body shape matches
 * /api/ai/edit so the modal can reuse its request-building code.
 *
 * Response payload is *content only* — no edit-format prompt, no JSON
 * instructions. The caller brings their own prompt.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const body = (await request.json()) as Partial<EditRequest> & { currentContent?: string }
  const { skriptId, pageId, frontPageId, currentContent } = body

  if ((!skriptId && !frontPageId) || (skriptId && frontPageId)) {
    return Response.json(
      { success: false, error: 'Provide exactly one of skriptId or frontPageId' },
      { status: 400 }
    )
  }

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
  } else {
    // Skript mode — same fetch + permission check as POST /api/ai/edit's
    // skript branch. Kept inline rather than factored out to avoid touching
    // the edit route in this change.
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

    const permissions = checkSkriptPermissions(
      userId,
      skript.authors,
      undefined,
      !!session.user.isAdmin
    )
    if (!permissions.canEdit) {
      return Response.json({ success: false, error: 'Edit access denied' }, { status: 403 })
    }

    // Inject the user's unsaved editor content for the focused page so the
    // copied context reflects what they're actually working on.
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

  const context = formatSkriptContext(skriptContext)

  return Response.json({
    success: true,
    context,
    characters: context.length,
    estimatedTokens: estimateTokenCount(context),
  })
}
