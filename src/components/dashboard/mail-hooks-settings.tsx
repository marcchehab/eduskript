'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { ChevronLeft, Mailbox, Trash2, Copy, Check } from 'lucide-react'

interface MailHook {
  id: string
  token: string
  label: string
  mode: string
  regex: string
  sourceEmail: string | null
  ttlMinutes: number | null
  createdAt: string
  forwardingAddress: string | null
  snippet: string
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-primary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function MailHooksSettings() {
  const [hooks, setHooks] = useState<MailHook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [regex, setRegex] = useState('')
  const [sourceEmail, setSourceEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const alert = useAlertDialog()

  async function load() {
    setError(null)
    try {
      const res = await fetch('/api/mail-hooks')
      if (!res.ok) throw new Error('Could not load mail hooks')
      const data = await res.json()
      setHooks(data.hooks as MailHook[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/mail-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          mode: 'login-code',
          regex: regex.trim() || undefined,
          sourceEmail: sourceEmail.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not create hook')
      }
      setLabel('')
      setRegex('')
      setSourceEmail('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  function remove(token: string, name: string) {
    alert.showConfirm(
      `Delete hook "${name}"? Its received codes are removed too.`,
      async () => {
        setDeleting(token)
        try {
          const res = await fetch(`/api/mail-hooks/${encodeURIComponent(token)}`, {
            method: 'DELETE',
          })
          if (!res.ok) throw new Error('Delete failed')
          await load()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
          setDeleting(null)
        }
      },
      { destructive: true, title: 'Delete mail hook', confirmText: 'Delete' }
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="sm" className="gap-2">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
        </div>

        <div>
          <h1 className="text-3xl font-bold">Mail Hooks</h1>
          <p className="text-muted-foreground mt-2">
            Forward login-code emails (e.g. from a shared Udemy account) into a{' '}
            <code>&lt;login-codes&gt;</code> block on your page. Create a hook,
            point your account&apos;s email forwarding at its address, and the
            6-digit codes show up live for signed-in students.
          </p>
        </div>

        {error && (
          <Card className="p-4 border-red-200 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </Card>
        )}

        {/* Create */}
        <Card className="p-5">
          <form onSubmit={create} className="space-y-4">
            <div>
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Udemy – Class 3a"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="sourceEmail">
                Source email <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="sourceEmail"
                value={sourceEmail}
                onChange={(e) => setSourceEmail(e.target.value)}
                placeholder="kurse@yourdomain.com"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Fallback matcher if sub-addressing isn&apos;t preserved.
              </p>
            </div>
            <div>
              <Label htmlFor="regex">
                Code regex <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="regex"
                value={regex}
                onChange={(e) => setRegex(e.target.value)}
                placeholder="Default: 6-digit code in an <h1>"
                className="mt-1 font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Override the default extractor. First capture group is the code.
              </p>
            </div>
            <Button type="submit" disabled={creating || !label.trim()}>
              {creating ? 'Creating…' : 'Create hook'}
            </Button>
          </form>
        </Card>

        {/* List */}
        {hooks === null ? (
          <Card className="p-6 text-muted-foreground">Loading…</Card>
        ) : hooks.length === 0 ? (
          <Card className="p-8 text-center">
            <Mailbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <h2 className="font-semibold mb-1">No mail hooks yet</h2>
            <p className="text-sm text-muted-foreground">
              Create one above to start forwarding login codes onto your pages.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {hooks.map((hook) => (
              <Card key={hook.id} className="p-5 space-y-3">
                <div className="flex items-start gap-4">
                  <Mailbox className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{hook.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {hook.mode}
                      {hook.ttlMinutes ? ` · codes expire after ${hook.ttlMinutes}m` : ''}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={deleting === hook.token}
                    onClick={() => remove(hook.token, hook.label)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleting === hook.token ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>

                <div className="rounded-md bg-muted p-3 space-y-2 text-sm">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Forward emails to
                    </div>
                    {hook.forwardingAddress ? (
                      <div className="flex items-center justify-between gap-2">
                        <code className="break-all">{hook.forwardingAddress}</code>
                        <CopyButton value={hook.forwardingAddress} />
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        CLOUDMAILIN_INBOX_ADDRESS is not configured — set it to
                        show the forwarding address.
                      </p>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Add to a page
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="break-all">{hook.snippet}</code>
                      <CopyButton value={hook.snippet} />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
        onConfirm={alert.onConfirm}
        showCancel={alert.showCancel}
        confirmText={alert.confirmText}
        cancelText={alert.cancelText}
        destructive={alert.destructive}
      />
    </>
  )
}
