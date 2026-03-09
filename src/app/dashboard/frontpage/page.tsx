import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'

export default async function UserFrontPageEditPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  // Only teachers can have frontpages
  if (session.user.accountType === 'student') {
    redirect('/dashboard')
  }

  // Gate behind paid plan
  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="front page editing" />
  }

  // Get user's frontpage if it exists
  const frontPage = await prisma.frontPage.findUnique({
    where: { userId: session.user.id }
  })

  // Get user's username for preview URL
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pageSlug: true }
  })

  const previewUrl = user?.pageSlug ? `/${user.pageSlug}` : undefined

  return (
    <FrontPageEditor
      type="user"
      frontPage={frontPage}
      backUrl="/dashboard"
      previewUrl={previewUrl}
    />
  )
}
