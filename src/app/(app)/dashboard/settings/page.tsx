import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { KeyRound, Mailbox } from 'lucide-react'

// Account settings = user-wide, not tied to a single site. Per-site settings
// (page identity, sidebar/typography, AI prompt, domains) moved to
// /dashboard/site/[siteId]/settings when multi-site landed. This page keeps the
// account-level items: connected apps and mail hooks.
export default async function SettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return null
  }

  // Redirect students to their profile page
  if (session.user.accountType === 'student') {
    redirect('/dashboard/profile')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Account settings</h1>
        <p className="text-muted-foreground mt-2">
          Settings that apply across your whole account. Per-site settings (page
          name, URL, frontpage, sidebar, AI prompt) live under each site.
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Connected Apps</CardTitle>
            <CardDescription>
              Manage AI assistants like claude.ai, Cursor, and Claude Code that
              can read and edit your content via MCP.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/settings/connected-apps">
              <Button variant="outline" className="gap-2">
                <KeyRound className="w-4 h-4" />
                Manage Connected Apps
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mail Hooks</CardTitle>
            <CardDescription>
              Forward login-code emails (e.g. a shared Udemy account) into a{' '}
              <code>&lt;login-codes&gt;</code> block on your pages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/settings/mail-hooks">
              <Button variant="outline" className="gap-2">
                <Mailbox className="w-4 h-4" />
                Manage Mail Hooks
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
