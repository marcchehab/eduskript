import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { PluginEditor } from '@/components/dashboard/plugin-editor'

/** Only same-app page-editor paths are accepted as return targets. */
function safeReturnTo(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && /^\/dashboard\/[\w\-/%]+$/.test(value) ? value : undefined
}

export default async function NewPluginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if (session.user.accountType === 'student') redirect('/dashboard/profile')
  const { returnTo } = await searchParams

  return (
    <PluginEditor
      userId={session.user.id}
      ownerSlug={session.user.pageSlug || ''}
      plugin={null}
      returnTo={safeReturnTo(returnTo)}
    />
  )
}
