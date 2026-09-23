'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Download, Trash2 } from 'lucide-react'

/**
 * "Your data" card: download a JSON export (GET /api/user/data-export) and
 * delete the account (DELETE /api/user/account).
 *
 * What deletion removes is decided in the DELETE route (cascades + skripts the
 * user authored alone); the dialog text below describes it per account type.
 */
const DELETE_TEXT = {
  teacher:
    'Your account, sites, classes, subscription and every skript you authored alone are deleted. Skripts you share with other authors stay with them. This cannot be undone.',
  student:
    'Your account and all your work are deleted, including answers, drawings and submitted exams. Your teachers will no longer see them. This cannot be undone.',
}

export function AccountDataCard({ accountType }: { accountType: 'teacher' | 'student' }) {
  const [error, setError] = useState<string | null>(null)

  const deleteAccount = async () => {
    setError(null)
    const res = await fetch('/api/user/account', { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Could not delete the account.')
      throw new Error('delete failed')
    }
    await signOut({ callbackUrl: '/' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Download everything Eduskript stores about your account, or delete it.
          See the{' '}
          <Link href="/datenschutz" className="underline">privacy policy</Link>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {/* Plain link: the route answers with Content-Disposition: attachment. */}
        <Button variant="outline" className="gap-2" asChild>
          <a href="/api/user/data-export" download>
            <Download className="w-4 h-4" />
            Download my data (JSON)
          </a>
        </Button>

        <ConfirmationDialog
          title="Delete account?"
          description={DELETE_TEXT[accountType]}
          confirmText="Delete account"
          variant="destructive"
          onConfirm={deleteAccount}
          trigger={
            <Button variant="outline" className="gap-2 text-destructive">
              <Trash2 className="w-4 h-4" />
              Delete account
            </Button>
          }
        />

        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
