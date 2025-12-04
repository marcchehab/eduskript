import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PageSettings } from '@/components/dashboard/page-settings'
import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return null
  }

  // Redirect students to their profile page
  const isStudent = session.user.accountType === 'student'
  if (isStudent) {
    redirect('/dashboard/profile')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          Page settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure your public page settings
        </p>
      </div>

      <div className="grid gap-6">
        <PageSettings />
      </div>
    </div>
  )
}
