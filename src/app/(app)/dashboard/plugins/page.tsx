import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PluginsDashboard } from '@/components/dashboard/plugins-dashboard'

export default async function PluginsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return null
  }

  if (session.user.accountType === 'student') {
    redirect('/dashboard/profile')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Plugins</h1>
        <p className="text-muted-foreground mt-2">
          Create, manage, and browse interactive components for your skripts
        </p>
      </div>
      <PluginsDashboard
        userId={session.user.id}
        userPageSlug={session.user.pageSlug || ''}
      />
    </div>
  )
}
