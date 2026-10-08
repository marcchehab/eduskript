import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { PageEditor } from '@/components/dashboard/page-editor'

const SITE_SELECT = { id: true, slug: true, organizationId: true } as const

interface PageParams {
  skriptSlug: string
  pageSlug: string
}

async function getPageData(skriptSlug: string, pageSlug: string, userId: string, isAdmin: boolean) {
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      ...(isAdmin ? {} : {
        authors: {
          some: { userId }
        }
      })
    },
    include: {
      pages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          isPublished: true,
          isUnlisted: true,
          pageType: true,
        }
      },
      authors: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              title: true,
            }
          }
        }
      },
      collectionSkripts: {
        include: {
          collection: true
        }
      }
    }
  })

  if (!skript) return null

  const page = await prisma.page.findFirst({
    where: {
      slug: pageSlug,
      skriptId: skript.id
    },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  })

  if (!page) return null

  const permissions = checkSkriptPermissions(userId, skript.authors, isAdmin)

  // Placed = the skript, or a collection containing it, is in some site's
  // PageLayout (anyone's: a co-author's skript counts if the owner placed it).
  // Unplaced skripts are missing from the public sidebar; the URL still works.
  const collectionIds = skript.collectionSkripts.map((cs) => cs.collectionId)
  const placement = await prisma.pageLayoutItem.findFirst({
    where: {
      OR: [
        { type: 'skript', contentId: skript.id },
        ...(collectionIds.length ? [{ type: 'collection', contentId: { in: collectionIds } }] : []),
      ],
    },
    select: { pageLayout: { select: { site: { select: SITE_SELECT } } } },
  })

  // The site this skript is shown on: where it's placed, else the site of its
  // collection. Drives the editor's back link and public URLs, which used to
  // assume the user's primary site (wrong for second sites and co-authors).
  // If a skript is placed on several sites, the first placement wins.
  const collectionSiteId = skript.collectionSkripts[0]?.collection?.siteId
  const site = placement?.pageLayout.site
    ?? (collectionSiteId
      ? await prisma.site.findUnique({ where: { id: collectionSiteId }, select: SITE_SELECT })
      : null)

  return { skript, page, permissions, placed: !!placement, site }
}

export default async function PageEditPage({
  params
}: {
  params: Promise<PageParams>
}) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return notFound()
  }

  // Content editing is free — paid features (AI, sync, classes) gate at their call sites.

  const { skriptSlug, pageSlug } = await params
  const data = await getPageData(skriptSlug, pageSlug, session.user.id, !!session.user.isAdmin)

  if (!data) {
    return notFound()
  }

  const { skript, page, permissions, placed, site } = data

  return (
    <PageEditor
      skript={{
        id: skript.id,
        slug: skript.slug,
        title: skript.title,
        description: skript.description,
        isPublished: skript.isPublished,
        isUnlisted: skript.isUnlisted,
        pages: skript.pages,
        authors: skript.authors,
        collectionSkripts: skript.collectionSkripts,
      }}
      page={{
        ...page,
        examSettings: page.examSettings as { requireSEB?: boolean } | null
      }}
      canEdit={permissions.canEdit}
      placed={placed}
      site={site}
      baseVersion={page.versions[0]?.version ?? 0}
      userPermissions={permissions}
      currentUserId={session.user.id}
    />
  )
}
