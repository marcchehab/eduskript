import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { loadThemeEditorData } from '@/lib/theme-editor-data'
import { ThemeEditor } from '@/components/dashboard/theme-editor'

// Theme editor for one of the caller's personal sites. The org variant is
// /dashboard/org/[orgId]/theme; both render the same ThemeEditor.
export default async function SiteThemePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) redirect('/auth/login')
  if (session.user.accountType === 'student') redirect('/dashboard/profile')

  const data = await loadThemeEditorData(session.user.id, siteId)
  if (!data) notFound()

  return <ThemeEditor {...data} />
}
