import { PageBuilderInterface } from '@/components/dashboard/page-builder-interface'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export default async function SitePageBuilderPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const session = await getServerSession(authOptions)

  if (session?.user?.accountType === 'student') {
    redirect('/dashboard/my-classes')
  }
  if (!session?.user?.id) {
    redirect('/auth/login')
  }

  // Ownership gate: the site must belong to this user.
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true, slug: true, pageName: true },
  })
  if (!site) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Page Builder</h1>
        <p className="text-muted-foreground mt-2">
          Building <span className="font-medium">{site.pageName || site.slug}</span> — drag content from your library
        </p>
      </div>

      <PageBuilderInterface context={{ type: 'user', siteId: site.id, siteSlug: site.slug }} />
    </div>
  )
}
