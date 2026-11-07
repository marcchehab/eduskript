'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Download, Trash2 } from 'lucide-react'
import type { AccountDeletionMode, AccountDeletionPreview, CoAuthor } from '@/lib/account-deletion'

/**
 * "Your data" card: download a JSON export (GET /api/user/data-export) and
 * delete the account (DELETE /api/user/account).
 *
 * Teachers choose what happens to content shared with other authors
 * ("delete" | "transfer", see src/lib/account-deletion.ts). The counts and
 * shared items come from GET /api/user/account (`deletion`), loaded on mount.
 * If that request fails the dialog still works, without the lists.
 */
const DELETE_TEXT = {
  teacher:
    'Your account, sites, collections, classes and subscription are deleted. Choose what happens to skripts and pages you share with other authors. This cannot be undone.',
  student:
    'Your account and all your work are deleted, including answers, drawings and submitted exams. Your teachers will no longer see them. This cannot be undone.',
}

function names(authors: CoAuthor[]): string {
  return authors.map((a) => a.name || a.email || 'Unknown user').join(', ')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function AccountDataCard({ accountType }: { accountType: 'teacher' | 'student' }) {
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<AccountDeletionMode>('transfer')
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null)

  useEffect(() => {
    if (accountType !== 'teacher') return
    let cancelled = false
    fetch('/api/user/account')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.deletion) setPreview(data.deletion) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [accountType])

  const deleteAccount = async () => {
    setError(null)
    const res = await fetch('/api/user/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: accountType === 'teacher' ? mode : 'transfer' }),
    })
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
        >
          {accountType === 'teacher' && (
            <DeletionOptions mode={mode} onModeChange={setMode} preview={preview} />
          )}
        </ConfirmationDialog>

        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

function DeletionOptions({
  mode,
  onModeChange,
  preview,
}: {
  mode: AccountDeletionMode
  onModeChange: (mode: AccountDeletionMode) => void
  preview: AccountDeletionPreview | null
}) {
  const sole = preview ? preview.soleSkripts : null
  const sharedCount = preview ? preview.sharedSkripts.length + preview.sharedPages.length : null
  const hasShared = !!sharedCount

  return (
    <div className="space-y-3 text-sm">
      <label className="flex gap-2 items-start cursor-pointer">
        <input
          type="radio"
          name="deletion-mode"
          className="mt-1"
          checked={mode === 'transfer'}
          onChange={() => onModeChange('transfer')}
        />
        <span>
          <span className="font-medium">Leave shared content to co-authors</span>
          <span className="block text-muted-foreground">
            Only content you authored alone is deleted
            {sole !== null && ` (${plural(sole, 'skript')}${preview!.solePages ? `, ${plural(preview!.solePages, 'page')}` : ''})`}.
            {sharedCount !== null && ` ${plural(sharedCount, 'shared item')} stay with the other authors.`}
          </span>
        </span>
      </label>
      <label className="flex gap-2 items-start cursor-pointer">
        <input
          type="radio"
          name="deletion-mode"
          className="mt-1"
          checked={mode === 'delete'}
          onChange={() => onModeChange('delete')}
        />
        <span>
          <span className="font-medium">Delete all my content</span>
          <span className="block text-muted-foreground">
            Everything you are an author of is deleted, including shared content. Your co-authors lose it too.
          </span>
        </span>
      </label>

      {hasShared && (
        <div className={mode === 'delete' ? 'rounded-md border border-destructive/50 p-3' : 'rounded-md border p-3'}>
          <p className="font-medium mb-2">
            {mode === 'delete' ? 'Shared content that will be deleted for everyone:' : 'Shared content that stays with your co-authors:'}
          </p>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {preview!.sharedSkripts.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.title}</span>{' '}
                <span className="text-muted-foreground">(skript, with {names(s.coAuthors)})</span>
              </li>
            ))}
            {preview!.sharedPages.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.title}</span>{' '}
                <span className="text-muted-foreground">(page in {p.skriptTitle}, with {names(p.coAuthors)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
