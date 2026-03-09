import { PageBuilderInterface } from '@/components/dashboard/page-builder-interface'
import { AdminPageBuilderPlaceholder } from '@/components/dashboard/admin-page-builder-placeholder'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export default async function PageBuilderPage() {
  const session = await getServerSession(authOptions)

  // Redirect students to their dashboard
  if (session?.user?.accountType === 'student') {
    redirect('/dashboard/my-classes')
  }

  // Gate behind paid plan
  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="the page builder" />
  }

  // Show placeholder only for the default eduadmin account, not all admins
  if (session?.user?.pageSlug === 'eduadmin') {
    const [userCount, orgCount] = await Promise.all([
      prisma.user.count({ where: { NOT: { pageSlug: 'eduadmin' } } }),
      prisma.organization.count(),
    ])
    const canSeed = userCount === 0 && orgCount === 0

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Page Builder</h1>
        </div>
        <AdminPageBuilderPlaceholder canSeed={canSeed} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          Page Builder
        </h1>
        <p className="text-muted-foreground mt-2">
          Build your personal page by dragging content from your library
        </p>
      </div>

      <PageBuilderInterface />
    </div>
  )
}