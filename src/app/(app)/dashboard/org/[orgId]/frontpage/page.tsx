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

  // Get organization details — slug lives on its Site now.
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      site: { select: { id: true, slug: true } },
    },
  })

  if (!organization || !organization.site) {
    redirect('/dashboard')
  }

  const frontPage = await prisma.frontPage.findUnique({
    where: { siteId: organization.site.id },
  })

  const previewUrl = `/org/${organization.site.slug}`

  return (
    <FrontPageEditor
      type="organization"
      frontPage={frontPage}
      organization={{ id: organization.id, name: organization.name, slug: organization.site.slug }}
      backUrl={`/dashboard/org/${orgId}/page-builder`}
      previewUrl={previewUrl}
    />
  )
}
