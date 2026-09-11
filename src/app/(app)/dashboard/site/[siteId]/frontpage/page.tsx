import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export default async function SiteFrontpagePage({
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
    redirect('/dashboard/my-classes')
  }

  // Ownership gate.
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true, slug: true },
  })
  if (!site) notFound()

  const frontPage = await prisma.frontPage.findUnique({ where: { siteId: site.id } })

  return (
    <FrontPageEditor
      type="user"
      siteId={site.id}
      frontPage={frontPage}
      backUrl={`/dashboard/site/${site.id}/page-builder`}
      previewUrl={`/${site.slug}`}
    />
  )
}
