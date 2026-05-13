import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getOrgMembership } from '@/lib/org-auth'
import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'

export default async function OrgFrontPageEditPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  // Check if user is admin/owner of this organization
  const membership = await getOrgMembership(session.user.id, orgId)
  const isPlatformAdmin = session.user.isAdmin

  if (!isPlatformAdmin && (!membership || (membership.role !== 'owner' && membership.role !== 'admin'))) {
    redirect(`/dashboard/org/${orgId}`)
  }

  // Get organization details
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  })

  if (!organization) {
    redirect('/dashboard')
  }

  // Get org's site and its frontpage (FrontPage now keys on siteId).
  const orgSite = await prisma.site.findUnique({
    where: { organizationId: orgId },
    select: { id: true },
  })
  const frontPage = orgSite
    ? await prisma.frontPage.findUnique({ where: { siteId: orgSite.id } })
    : null

  const previewUrl = `/org/${organization.slug}`

  return (
    <FrontPageEditor
      type="organization"
      frontPage={frontPage}
      organization={organization}
      backUrl={`/dashboard/org/${orgId}/page-builder`}
      previewUrl={previewUrl}
    />
  )
}
