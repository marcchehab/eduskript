import Link from 'next/link'
import { findInvite } from '@/lib/email-login'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InviteActions } from './invite-actions'

/**
 * Landing page of a class-invite mail (src/lib/email-login.ts).
 * Rendering does NOT consume the link: school mail scanners (e.g. Microsoft
 * Defender Safe Links) open links before the student does. Only the button
 * (a POST via signIn) consumes it.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await findInvite(token)

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4">
      <Card className="w-full max-w-md">
        {invite ? (
          <>
            <CardHeader>
              <CardTitle className="text-2xl text-center">Join {invite.cls.name}</CardTitle>
              <CardDescription className="text-center">
                {invite.cls.teacher?.name ?? 'Your teacher'} invited you to this class.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteActions token={token} inviteCode={invite.cls.inviteCode} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-2xl text-center">Invite link expired</CardTitle>
              <CardDescription className="text-center">
                This link was already used or is no longer valid.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm">
              <Link href="/auth/signin" className="text-primary hover:underline">
                Sign in with your email address
              </Link>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
