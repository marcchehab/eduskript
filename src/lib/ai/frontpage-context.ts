import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import type { SkriptContext } from '@/lib/ai/types'

export interface FrontPageContextResult {
  ok: true
  skriptContext: SkriptContext
  /** Current frontpage content (may differ from DB if user has unsaved changes — caller injects via currentContent override) */
  content: string
  /** Display title used by the AI (e.g. user pageName, skript title, organization name) */
  title: string
}

export interface FrontPageContextError {
  ok: false
  status: number
  error: string
}

/**
 * Load a FrontPage and build a SkriptContext containing a single virtual page
 * representing the frontpage content. Performs the three-way permission check:
 * - user frontpage: requester must own it
 * - skript frontpage: requester must have edit access on the skript
 * - org frontpage: requester must be owner/admin of the org
 *
 * The virtual "skript" carries placeholder metadata. The "page" id is the frontPageId
 * itself, so the AI's edit response can be applied directly back to the FrontPage.
 *
 * `currentContent` lets callers inject unsaved editor content as the live page body,
 * matching the behavior of skript-mode AI edit (`focusedPageId` + `currentContent`).
 */
export async function loadFrontPageContext(args: {
  frontPageId: string
  userId: string
  isAdmin?: boolean
  currentContent?: string | null
}): Promise<FrontPageContextResult | FrontPageContextError> {
  const { frontPageId, userId, isAdmin, currentContent } = args

  const frontPage = await prisma.frontPage.findUnique({
    where: { id: frontPageId },
    include: {
      user: { select: { id: true, name: true, pageName: true, pageSlug: true } },
      organization: { select: { id: true, name: true, slug: true } },
      skript: {
        include: {
          authors: { include: { user: true } },
          files: { select: { id: true, name: true, contentType: true } },
          collectionSkripts: {
            include: { collection: { include: { authors: { include: { user: true } } } } },
          },
        },
      },
      fileSkript: { select: { id: true, files: { select: { id: true, name: true, contentType: true } } } },
    },
  })

  if (!frontPage) {
    return { ok: false, status: 404, error: 'Front page not found' }
  }

  let canEdit = false
  if (frontPage.userId && frontPage.userId === userId) canEdit = true
  if (frontPage.skript) {
    const collectionAuthors = frontPage.skript.collectionSkripts
      .filter((cs) => cs.collection !== null)
      .flatMap((cs) => cs.collection!.authors)
    const perms = checkSkriptPermissions(userId, frontPage.skript.authors, collectionAuthors, !!isAdmin)
    if (perms.canEdit) canEdit = true
  }
  if (frontPage.organizationId) {
    const membership = await prisma.organizationMember.findFirst({
      where: {
        organizationId: frontPage.organizationId,
        userId,
        role: { in: ['owner', 'admin'] },
      },
      select: { id: true },
    })
    if (membership) canEdit = true
  }

  if (!canEdit) {
    return { ok: false, status: 403, error: 'You do not have permission to edit this front page' }
  }

  const content = currentContent ?? frontPage.content

  // Files for the AI to reference: skript frontpages reuse the skript's files;
  // user/org frontpages use the hidden fileSkript created on demand.
  const files = frontPage.skript?.files ?? frontPage.fileSkript?.files ?? []

  const title = frontPage.skript?.title
    ?? frontPage.organization?.name
    ?? frontPage.user?.pageName
    ?? frontPage.user?.name
    ?? 'Front Page'

  const slug = frontPage.skript?.slug
    ?? frontPage.organization?.slug
    ?? frontPage.user?.pageSlug
    ?? 'frontpage'

  const skriptContext: SkriptContext = {
    skript: {
      id: `frontpage:${frontPageId}`,
      title: `Front page: ${title}`,
      description: 'Single front page document — there are no other pages in this context.',
      slug,
      isPublished: frontPage.isPublished,
    },
    pages: [
      {
        id: frontPageId,
        title: 'Front Page',
        slug: 'frontpage',
        content,
        order: 0,
        isPublished: frontPage.isPublished,
      },
    ],
    files,
    focusedPageId: frontPageId,
  }

  return { ok: true, skriptContext, content, title }
}
