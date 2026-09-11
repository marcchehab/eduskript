import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
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

  // Look up the user's primary site (a user may own several) and its
  // frontpage. Site owns site-level frontpages.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { id: true, slug: true } } }
  })
  const site = user?.sites[0]

  const frontPage = site
    ? await prisma.frontPage.findUnique({ where: { siteId: site.id } })
    : null

  const previewUrl = site?.slug ? `/${site.slug}` : undefined

  return (
    <FrontPageEditor
      type="user"
      frontPage={frontPage}
      backUrl="/dashboard"
      previewUrl={previewUrl}
    />
  )
}
