'use client'

/**
 * Dialogs for the temporary-user flow in the class toolbar:
 *  - CredentialsDialog: shows a freshly created temp account's email + password
 *    ONCE (copy buttons) so the teacher can log a student in on a spare laptop.
 *  - TransferAnswersDialog: search any student across the teacher's classes
 *    (real email resolved via the local email mapping) and copy the temp user's
 *    exam answers onto them. See /api/teacher/temp-users/[sourceId]/transfer.
 *
 * Strings are English per project convention; no browser alerts.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Copy, Check, ArrowLeftRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { getReverseMappingsForClass } from '@/lib/email-mapping-db'

export interface TempCredentials {
  email: string
  password: string
  displayName: string
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded border bg-muted px-2 py-1 text-sm break-all">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

export function CredentialsDialog({
  creds,
  onClose,
}: {
  creds: TempCredentials | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary user created</DialogTitle>
          <DialogDescription>
            Log the student in on the spare device with these credentials. The password is shown
            only once — copy it now.
          </DialogDescription>
        </DialogHeader>
        {creds && (
          <div className="space-y-3">
            <CopyField label="Email" value={creds.email} />
            <CopyField label="Password" value={creds.password} />
            <p className="text-xs text-muted-foreground">
              This is a real student account ({creds.displayName}) in this class. After the exam,
              transfer its answers to the student&apos;s real account, then unenroll it.
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface Candidate {
  id: string
  displayName: string
  /** Resolved real email when available, else a pseudonym placeholder. */
  email: string
  classNames: string[]
}

export function TransferAnswersDialog({
  source,
  onClose,
  onTransferred,
}: {
  /** The temporary user to transfer FROM (null = closed). */
  source: { id: string; label: string } | null
  onClose: () => void
  onTransferred: (msg: string) => void
}) {
  const open = !!source
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCandidates([])
      setQuery('')
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const classes: Array<{ id: string; name: string }> = await fetch('/api/classes', {
          cache: 'no-store',
        }).then((r) => (r.ok ? r.json() : { classes: [] })).then((j) => j.classes ?? [])

        const byStudent = new Map<string, Candidate>()
        for (const cls of classes) {
          const [studentsRes, reverseMap] = await Promise.all([
            fetch(`/api/classes/${cls.id}/students`, { cache: 'no-store' })
              .then((r) => (r.ok ? r.json() : { students: [] }))
              .then((j) => j.students ?? []),
            getReverseMappingsForClass(cls.id).catch(() => ({} as Record<string, string>)),
          ])
          for (const s of studentsRes as Array<{
            id: string
            displayName: string
            pseudonym: string | null
            email: string
            revealedEmail: string | null
          }>) {
            if (s.id === source!.id) continue // never transfer onto the source
            const realEmail =
              (s.pseudonym ? reverseMap[s.pseudonym] : undefined) || s.revealedEmail || ''
            const existing = byStudent.get(s.id)
            if (existing) {
              if (!existing.classNames.includes(cls.name)) existing.classNames.push(cls.name)
            } else {
              byStudent.set(s.id, {
                id: s.id,
                displayName: s.displayName,
                email: realEmail || s.email,
                classNames: [cls.name],
              })
            }
          }
        }
        if (!cancelled) setCandidates([...byStudent.values()])
      } catch {
        if (!cancelled) setError('Could not load students.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, source])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? candidates.filter(
          (c) => c.email.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q),
        )
      : candidates
    return list.slice(0, 50)
  }, [candidates, query])

  const transfer = async (target: Candidate) => {
    if (!source) return
    setBusyId(target.id)
    setError(null)
    try {
      const res = await fetch(`/api/teacher/temp-users/${source.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: target.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Transfer failed')
      onTransferred(
        `Transferred ${source.label}'s work to ${target.email || target.displayName} ` +
          `(${j.pages ?? j.pageIds?.length ?? 0} exam${(j.pages ?? 1) === 1 ? '' : 's'}).`,
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" /> Transfer answers
          </DialogTitle>
          <DialogDescription>
            Copy {source?.label}&apos;s exam answers onto a real student in any of your classes. The
            temporary account is kept as a backup.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or name…"
            className="pl-8"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading students…
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No matching students.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.email || c.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.displayName} · {c.classNames.join(', ')}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId !== null}
                    onClick={() => transfer(c)}
                  >
                    {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Transfer →'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
