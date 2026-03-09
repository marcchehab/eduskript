import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SkriptFrontPageProps {
  params: Promise<{
    skriptSlug: string
  }>
}

export default async function SkriptFrontPageEditPage({ params }: SkriptFrontPageProps) {
  const session = await getServerSession(authOptions)
  const { skriptSlug } = await params

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="front page editing" />
  }

  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      authors: {
        some: {
          userId: session.user.id
        }
      }
    },
    include: {
      authors: {
        include: {
          user: true
        }
      },
      frontPage: true
    }
  })

  if (!skript) {
    notFound()
  }

  const permissions = checkSkriptPermissions(session.user.id, skript.authors)

  if (!permissions.canEdit) {
    redirect(`/dashboard/skripts/${skriptSlug}`)
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pageSlug: true }
  })

  const previewUrl = user?.pageSlug
    ? `/${user.pageSlug}/${skriptSlug}`
    : undefined

  return (
    <FrontPageEditor
      type="skript"
      frontPage={skript.frontPage}
      skript={{
        id: skript.id,
        slug: skript.slug,
        title: skript.title,
      }}
      backUrl={`/dashboard/skripts/${skriptSlug}`}
      previewUrl={previewUrl}
    />
  )
}
