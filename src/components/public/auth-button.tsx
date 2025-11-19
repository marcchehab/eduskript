'use client'

import { signIn, useSession } from 'next-auth/react'
import Image from 'next/image'
import { useRouter, usePathname } from 'next/navigation'
import { LogIn, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAccountTypeFromWindow } from '@/lib/domain-utils'

export function AuthButton() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const { data: session } = useSession()

  const handleSignIn = () => {
    // Detect account type based on domain
    const accountType = getAccountTypeFromWindow()
    const accountTypeParam = accountType === 'student' ? 'student' : 'teacher'

    router.push(`/auth/signin?type=${accountTypeParam}&callbackUrl=${encodeURIComponent(pathname)}`)
  }

  if (!session) {
    // Not logged in - show login button
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSignIn}
        title="Login"
        className="rounded-full"
      >
        <LogIn className="h-5 w-5" />
      </Button>
    )
  }

  // Logged in - show user avatar or icon, click to go to dashboard
  const isStudent = session.user?.accountType === 'student'
  const userName = isStudent
    ? (session.user?.studentPseudonym
        ? `Student ${session.user.studentPseudonym.substring(0, 4)}`
        : 'Student')
    : session.user?.name || 'User'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => router.push('/dashboard')}
      title={`Go to dashboard (${userName})`}
      className="rounded-full overflow-hidden p-0"
    >
      {session.user?.image && !isStudent ? (
        // Show profile picture for teachers (Microsoft provides it, not stored on server)
        // For students: don't show image even if Microsoft provides one (privacy)
        <Image
          src={session.user.image}
          alt={userName}
          width={40}
          height={40}
          className="rounded-full opacity-90 hover:opacity-100 transition-opacity"
        />
      ) : (
        // Show icon for students or teachers without images
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
          <UserCheck className="h-5 w-5 text-primary" />
        </div>
      )}
    </Button>
  )
}
