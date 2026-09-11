import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageSettings } from '@/components/dashboard/page-settings'

// Per-site settings (page identity, sidebar/typography, AI prompt). Scoped to
// one of the caller's sites via `siteId`; PageSettings threads that into every
// read/write so a teacher with several sites edits the right one. Account-level
// settings (connected apps, mail hooks, import/export) live at /dashboard/settings.
export default async function SiteSettingsPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/login')
  }
  if (session.user.accountType === 'student') {
    redirect('/dashboard/profile')
  }

  // Ownership gate.
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true, slug: true, pageName: true },
  })
  if (!site) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Page settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure the public page for{' '}
          <span className="font-medium">{site.pageName || site.slug}</span>
        </p>
      </div>

      <div className="grid gap-6">
        <PageSettings siteId={site.id} />
      </div>
    </div>
  )
}
