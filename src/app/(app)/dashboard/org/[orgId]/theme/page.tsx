import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { loadThemeEditorData } from '@/lib/theme-editor-data'
import { ThemeEditor } from '@/components/dashboard/theme-editor'

// Theme editor for an organization's site. Access = org owner/admin
// (enforced by loadThemeEditorData via getManagedSiteIds; no platform-admin
// bypass, same as the save route's canManageSite).
export default async function OrgThemePage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) redirect('/auth/login')
  if (session.user.accountType === 'student') redirect('/dashboard/profile')

  const site = await prisma.site.findUnique({ where: { organizationId: orgId }, select: { id: true } })
  if (!site) notFound()

  const data = await loadThemeEditorData(session.user.id, site.id)
  if (!data) notFound()

  return <ThemeEditor {...data} />
}
