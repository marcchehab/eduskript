import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { PageEditor } from '@/components/dashboard/page-editor'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'
import { loadSkriptForEditor, toEditorSkript } from '@/lib/skript-editor-data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SkriptFrontPageProps {
  params: Promise<{
    skriptSlug: string
  }>
}

/**
 * Skript front page, edited in the same PageEditor as the skript's pages
 * (front-page mode: no title/slug/settings, Draft/Published only, saves and
 * versions go to the FrontPage API). Site/org front pages still use
 * FrontPageEditor.
 */
export default async function SkriptFrontPageEditPage({ params }: SkriptFrontPageProps) {
  const session = await getServerSession(authOptions)
  const { skriptSlug } = await params

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="frontpage" />
  }

  const data = await loadSkriptForEditor(skriptSlug, session.user.id, !!session.user.isAdmin)
  if (!data) {
    notFound()
  }
  const { skript, permissions, placed, site } = data

  if (!permissions.canEdit) {
    redirect(`/dashboard/skripts/${skriptSlug}`)
  }

  const fp = skript.frontPage
  return (
    <PageEditor
      skript={toEditorSkript(skript)}
      page={{
        id: fp?.id ?? `frontpage:${skript.id}`,
        title: 'Skript front page',
        slug: '',
        content: fp?.content ?? '',
        isPublished: fp?.isPublished ?? false,
        isUnlisted: false,
        pageType: 'normal',
      }}
      frontPage={{ id: fp?.id ?? null }}
      skriptFrontPage={fp ? { isPublished: fp.isPublished } : null}
      canEdit={permissions.canEdit}
      placed={placed}
      site={site}
      baseVersion={0}
      userPermissions={permissions}
      currentUserId={session.user.id}
    />
  )
}
