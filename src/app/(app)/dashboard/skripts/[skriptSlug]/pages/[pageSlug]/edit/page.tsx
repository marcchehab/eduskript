import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageEditor } from '@/components/dashboard/page-editor'
import { loadSkriptForEditor, toEditorSkript } from '@/lib/skript-editor-data'

interface PageParams {
  skriptSlug: string
  pageSlug: string
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
  const data = await loadSkriptForEditor(skriptSlug, session.user.id, !!session.user.isAdmin)
  if (!data) {
    return notFound()
  }
  const { skript, permissions, placed, site } = data

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
  if (!page) {
    return notFound()
  }

  return (
    <PageEditor
      skript={toEditorSkript(skript)}
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
      skriptFrontPage={skript.frontPage ? { isPublished: skript.frontPage.isPublished } : null}
    />
  )
}
