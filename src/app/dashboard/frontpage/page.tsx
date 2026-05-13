import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'

export default async function UserFrontPageEditPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  // Only teachers can have frontpages
  if (session.user.accountType === 'student') {
    redirect('/dashboard')
  }

  // Front page editing is free — part of the core publish-and-be-read experience.

  // Look up the user's site (1:1) and its frontpage. Site is the new owner
  // for site-level frontpages; the legacy userId column has been retired.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { site: { select: { id: true, slug: true } } }
  })

  const frontPage = user?.site
    ? await prisma.frontPage.findUnique({ where: { siteId: user.site.id } })
    : null

  const previewUrl = user?.site?.slug ? `/${user.site.slug}` : undefined

  return (
    <FrontPageEditor
      type="user"
      frontPage={frontPage}
      backUrl="/dashboard"
      previewUrl={previewUrl}
    />
  )
}
