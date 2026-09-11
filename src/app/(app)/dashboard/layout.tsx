import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { DashboardNav } from '@/components/dashboard/nav'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { ErrorProvider } from '@/contexts/error-context'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  // Check if user needs to reset password
  if (session.user.requirePasswordReset) {
    redirect('/auth/reset-password')
  }

  // Check if teacher needs to complete their profile (new OAuth signups)
  if (session.user.needsProfileCompletion) {
    redirect('/auth/complete-profile')
  }

  return (
    <ErrorProvider>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <DashboardNav />
        <div className="flex flex-1 overflow-hidden">
          <DashboardSidebar />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </ErrorProvider>
  )
}
