import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { PageEditor } from '@/components/dashboard/page-editor'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'

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

  const permissions = checkSkriptPermissions(userId, skript.authors, undefined, isAdmin)

  return { skript, page, permissions }
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

  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="content editing" />
  }

  const { skriptSlug, pageSlug } = await params
  const data = await getPageData(skriptSlug, pageSlug, session.user.id, !!session.user.isAdmin)

  if (!data) {
    return notFound()
  }

  const { skript, page, permissions } = data

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
      userPermissions={permissions}
      currentUserId={session.user.id}
    />
  )
}
