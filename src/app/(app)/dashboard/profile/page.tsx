import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ProfileSettings } from '@/components/dashboard/profile-settings'
import { redirect } from 'next/navigation'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return null
  }

  // Redirect teachers to their page settings
  const isTeacher = session.user.accountType === 'teacher'
  if (isTeacher) {
    redirect('/dashboard/settings')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground mt-2">
          Manage your display name and profile information
        </p>
      </div>

      <div className="max-w-2xl">
        <ProfileSettings />
      </div>
    </div>
  )
}
