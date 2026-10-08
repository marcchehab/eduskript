'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface Props {
  canSeed: boolean
}

export function AdminSiteBuilderPlaceholder({ canSeed }: Props) {
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ orgId: string; orgSlug: string } | null>(null)

  const handleSeed = async () => {
    setSeeding(true)
    setError('')

    try {
      const response = await fetch('/api/admin/seed-example-data', { method: 'POST' })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to seed data')
      }

      setResult(data.data)
      // Refresh sidebar without full page reload (preserves success message)
      window.dispatchEvent(new Event('sidebar:refresh'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-6 max-w-lg mx-auto">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">You&apos;re logged in as eduadmin</h2>
        <p className="text-muted-foreground">
          Eduadmin is the default super admin and doesn&apos;t have a personal page. You can create
          an organization and users who can be super admins.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive w-full">
          {error}
        </div>
      )}

      {result ? (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400 w-full space-y-2">
          <p className="font-medium">Sample data created!</p>
          <p>Email: <code className="bg-green-500/10 px-1 rounded">teacher@eduskript.org</code></p>
          <p>Password: <code className="bg-green-500/10 px-1 rounded">teacher</code></p>
          <Link
            href={`/dashboard/org/${result.orgId}/site-builder`}
            className="inline-block underline font-medium"
          >
            Go to &ldquo;{result.orgSlug}&rdquo; org site builder →
          </Link>
        </div>
      ) : (
        <div className="flex gap-3">
          {canSeed && (
            <Button onClick={handleSeed} disabled={seeding} variant="default">
              {seeding ? 'Seeding...' : 'Seed Sample Data'}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard/admin">Go to Admin Panel →</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
