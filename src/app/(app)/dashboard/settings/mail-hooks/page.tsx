import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { MailHooksSettings } from '@/components/dashboard/mail-hooks-settings'

export default async function MailHooksPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/signin?callbackUrl=/dashboard/settings/mail-hooks')
  }

  if (session.user.accountType === 'student') {
    redirect('/dashboard/profile')
  }

  return <MailHooksSettings />
}
