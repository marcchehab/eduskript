import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { PageEditor } from '@/components/dashboard/page-editor'

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

  // "On your page": the skript, or a collection containing it, is in the
  // PageLayout of any site this user owns. Drives the placement check of the
  // visibility badge (src/lib/visibility.ts); the URL works either way.
  const collectionIds = skript.collectionSkripts.map((cs) => cs.collectionId)
  const placement = await prisma.pageLayoutItem.findFirst({
    where: {
      pageLayout: { site: { userId } },
      OR: [
        { type: 'skript', contentId: skript.id },
        ...(collectionIds.length ? [{ type: 'collection', contentId: { in: collectionIds } }] : []),
      ],
    },
    select: { id: true },
  })

  return { skript, page, permissions, placed: !!placement }
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

  const { skript, page, permissions, placed } = data

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
      userPermissions={permissions}
      currentUserId={session.user.id}
    />
  )
}
