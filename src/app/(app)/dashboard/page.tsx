import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  // Redirect based on account type
  if (session?.user?.accountType === 'student') {
    redirect('/dashboard/my-classes')
  }

  // Teachers and others go to page-builder
  redirect('/dashboard/page-builder')
}
