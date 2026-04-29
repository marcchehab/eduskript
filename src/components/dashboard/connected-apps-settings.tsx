'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChevronLeft, KeyRound, Trash2 } from 'lucide-react'

interface ConnectedApp {
  clientId: string
  clientName: string
  tokenPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  issuedAt: string
}

const SCOPE_LABELS: Record<string, string> = {
  'content:read': 'Read content',
  'content:write': 'Create and edit content',
}

function formatDate(value: string | null): string {
  if (!value) return 'Never used'
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function ConnectedAppsSettings() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const response = await fetch('/api/user/connected-apps')
      if (!response.ok) throw new Error('Could not load apps')
      const data = await response.json()
      setApps(data.apps as ConnectedApp[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function revoke(clientId: string, name: string) {
    if (!confirm(`Revoke access for "${name}"?`)) return
    setRevoking(clientId)
    try {
      const response = await fetch(
        `/api/user/connected-apps/${encodeURIComponent(clientId)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error('Revocation failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/settings">
          <Button variant="ghost" size="sm" className="gap-2">
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold">Connected Apps</h1>
        <p className="text-muted-foreground mt-2">
          AI assistants like claude.ai, Cursor, or Claude Code that can access
          your Eduskript account via MCP.
        </p>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </Card>
      )}

      {apps === null ? (
        <Card className="p-6 text-muted-foreground">Loading…</Card>
      ) : apps.length === 0 ? (
        <Card className="p-8 text-center">
          <KeyRound className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <h2 className="font-semibold mb-1">No apps connected yet</h2>
          <p className="text-sm text-muted-foreground">
            Connect claude.ai, Cursor, or Claude Code to edit Eduskript content
            with natural language.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <Card key={app.clientId} className="p-5 flex items-start gap-4">
              <KeyRound className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{app.clientName}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  Token <code>{app.tokenPrefix}…</code> · last used:{' '}
                  {formatDate(app.lastUsedAt)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Permissions:{' '}
                  {app.scopes
                    .map((s) => SCOPE_LABELS[s] ?? s)
                    .join(', ') || '—'}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={revoking === app.clientId}
                onClick={() => revoke(app.clientId, app.clientName)}
              >
                <Trash2 className="w-4 h-4" />
                {revoking === app.clientId ? 'Revoking…' : 'Revoke'}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
