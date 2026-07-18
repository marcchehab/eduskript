import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TeacherDomainsManager } from '@/components/dashboard/teacher-domains-manager'

// Per-site custom domains. Ownership-gated; TeacherDomainsManager scopes every
// read/write to this site via siteId.
export default async function SiteDomainsPage({
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
    select: { id: true },
  })
  if (!site) notFound()

  return (
    <TeacherDomainsManager
      siteId={site.id}
      backUrl={`/dashboard/site/${site.id}/settings`}
    />
  )
}
