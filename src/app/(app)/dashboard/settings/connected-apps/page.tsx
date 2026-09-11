import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ConnectedAppsSettings } from '@/components/dashboard/connected-apps-settings'

export default async function ConnectedAppsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/signin?callbackUrl=/dashboard/settings/connected-apps')
  }

  if (session.user.accountType === 'student') {
    redirect('/dashboard/profile')
  }

  return <ConnectedAppsSettings />
}
