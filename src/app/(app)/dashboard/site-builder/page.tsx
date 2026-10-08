import { SiteBuilderInterface } from '@/components/dashboard/site-builder-interface'
import { AdminSiteBuilderPlaceholder } from '@/components/dashboard/admin-site-builder-placeholder'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

export default async function SiteBuilderPage() {
  const session = await getServerSession(authOptions)

  // Redirect students to their dashboard
  if (session?.user?.accountType === 'student') {
    redirect('/dashboard/my-classes')
  }

  // Site builder is free — authoring is the core free experience.
  // AI/classes/sync gating happens at the relevant call sites.

  // Show placeholder only for the default eduadmin account, not all admins.
  // session.user.pageSlug is grafted from Site.slug in auth.ts.
  if (session?.user?.pageSlug === 'eduadmin') {
    // Count "real" user sites (everything other than the eduadmin admin site)
    const [otherUserSiteCount, orgCount] = await Promise.all([
      prisma.site.count({
        where: {
          userId: { not: null },
          NOT: { slug: 'eduadmin' },
        },
      }),
      prisma.organization.count(),
    ])
    const canSeed = otherUserSiteCount === 0 && orgCount === 0

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Site Builder</h1>
        </div>
        <AdminSiteBuilderPlaceholder canSeed={canSeed} />
      </div>
    )
  }

  // Primary site (lowest `order`), including its verified primary custom
  // domain if set — see SiteBuilderContext.customDomain.
  const primarySite = session?.user?.id
    ? await prisma.site.findFirst({
        where: { userId: session.user.id },
        orderBy: PRIMARY_SITE_ORDER,
        select: {
          id: true,
          slug: true,
          teacherCustomDomains: {
            where: { isVerified: true, isPrimary: true },
            select: { domain: true },
            take: 1,
          },
        },
      })
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          Site Builder
        </h1>
        <p className="text-muted-foreground mt-2">
          Build your personal page by dragging content from your library
        </p>
      </div>

      <SiteBuilderInterface
        context={
          primarySite
            ? {
                type: 'user',
                siteId: primarySite.id,
                siteSlug: primarySite.slug,
                customDomain: primarySite.teacherCustomDomains[0]?.domain ?? null,
              }
            : undefined
        }
      />
    </div>
  )
}