'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { AlertTriangle, Check, Copy, RefreshCw, XCircle } from 'lucide-react'
import { CUSTOM_DOMAIN_TARGET, VERIFICATION_HOST_PREFIX } from '@/lib/custom-domains'
import type { DomainCheck } from '@/lib/domain-diagnostics'

export { CUSTOM_DOMAIN_TARGET, VERIFICATION_HOST_PREFIX }

function DnsField({ label, value, mono = 'text-sm' }: { label: string; value: string; mono?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className={`font-mono ${mono} bg-background px-2 py-1 rounded flex-1 break-all`}>
          {value}
        </code>
        {/* Feedback stays inside the dialog — a page-level success banner would
            render behind the modal overlay. */}
        <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

const STATUS_ICON = {
  ok: <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />,
  fail: <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />,
}

function CheckResults({ checks }: { checks: DomainCheck[] }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      {checks.map((check) => (
        <div key={check.id} className="flex gap-2 text-sm">
          {STATUS_ICON[check.status]}
          <div className="min-w-0">
            <div className="font-medium">{check.label}</div>
            <div className="text-muted-foreground break-words">{check.detail}</div>
            {check.hint && <div className="text-xs text-muted-foreground mt-0.5">{check.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * DNS setup for a custom domain: the TXT record we verify ownership with, plus
 * the CNAME that actually routes traffic to the app. Shared by the per-site
 * manager (teacher-domains-manager.tsx) and the org domains page.
 *
 * With `diagnoseUrl` it also runs the full configuration check (see
 * src/lib/domain-diagnostics.ts) — DNS records, activation state, and whether
 * the domain actually serves the app over HTTPS.
 *
 * Caveat: adding the CNAME is not sufficient on its own — the domain also has
 * to be attached to the Koyeb app so a TLS certificate is issued. That step is
 * still manual (no Koyeb API integration), hence the "we finish the setup"
 * wording below.
 */
export function DomainDnsInstructions({
  open,
  onOpenChange,
  domain,
  verificationToken,
  diagnoseUrl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string | null
  verificationToken: string | null
  diagnoseUrl?: string
}) {
  const host = domain || 'example.com'
  const [checks, setChecks] = useState<DomainCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  // Results belong to one domain; drop them when the dialog is reopened for
  // another (or the same) domain so stale checks are never shown as current.
  useEffect(() => {
    setChecks(null)
    setCheckError('')
  }, [open, diagnoseUrl])

  const runCheck = async () => {
    if (!diagnoseUrl) return
    setChecking(true)
    setCheckError('')
    try {
      const res = await fetch(diagnoseUrl)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Check failed')
      setChecks(data.checks)
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>DNS Setup for {host}</DialogTitle>
          <DialogDescription>
            Add both records at your DNS provider. Record 1 proves you own the domain,
            record 2 points visitors to your Eduskript site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {diagnoseUrl && (
            <div className="space-y-3">
              <Button variant="outline" size="sm" onClick={runCheck} disabled={checking} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking...' : 'Check configuration'}
              </Button>
              {checkError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{checkError}</div>
              )}
              {checks && <CheckResults checks={checks} />}
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-2">1. Ownership verification</p>
            <div className="bg-muted p-4 rounded-lg space-y-3">
              <DnsField label="Record Type" value="TXT" />
              <DnsField label="Name / Host" value={`${VERIFICATION_HOST_PREFIX}.${host}`} />
              <DnsField label="Value" value={verificationToken || ''} mono="text-xs" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Some providers want the name relative to the zone — then enter just{' '}
              <code className="font-mono">{VERIFICATION_HOST_PREFIX}</code>.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">2. Routing</p>
            <div className="bg-muted p-4 rounded-lg space-y-3">
              <DnsField label="Record Type" value="CNAME" />
              <DnsField label="Name / Host" value={host} />
              <DnsField label="Target" value={CUSTOM_DOMAIN_TARGET} mono="text-xs" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              For a root domain (no subdomain) your provider must support CNAME flattening
              or ALIAS/ANAME records. Cloudflare flattens CNAMEs at the root automatically.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              To serve <code className="font-mono">www.{host.replace(/^www\./, '')}</code> as well,
              add it here as a separate domain and give it a second CNAME with the same target.
            </p>
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium mb-1">Using Cloudflare?</p>
            <p className="text-muted-foreground">
              Set the CNAME to <strong>DNS only</strong> (grey cloud, proxy off). With the
              orange-cloud proxy enabled we cannot issue the TLS certificate for your domain
              and visitors get a certificate error.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            After adding the records, click &quot;Verify&quot;. DNS changes usually apply within
            minutes but can take up to 48 hours. Once verified we finish the setup on our side
            and issue the certificate; if your domain is still not reachable after a day, mail{' '}
            <a href="mailto:kontakt@luzmedia.ch" className="underline">
              kontakt@luzmedia.ch
            </a>
            .
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
