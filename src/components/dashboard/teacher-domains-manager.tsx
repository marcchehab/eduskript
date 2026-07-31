'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Globe, Plus, Trash2, CheckCircle, AlertCircle, Star, ChevronLeft, RefreshCw, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { DomainDnsInstructions, CUSTOM_DOMAIN_TARGET } from '@/components/dashboard/domain-dns-instructions'

interface TeacherDomain {
  id: string
  domain: string
  userId: string
  isPrimary: boolean
  isVerified: boolean
  verificationToken: string | null
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

// Custom-domains manager, scoped to a single site. `siteId` pins the list and
// new-domain creation to one of the caller's sites (multi-site); omitted → the
// APIs fall back to the primary site. `backUrl` is the settings page to return
// to (per-site or account). Rendered by both /dashboard/site/[siteId]/domains
// and the legacy /dashboard/settings/domains page.
export function TeacherDomainsManager({
  siteId,
  backUrl = '/dashboard/settings',
}: {
  siteId?: string
  backUrl?: string
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const dialog = useAlertDialog()
  const [domains, setDomains] = useState<TeacherDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showInstructionsDialog, setShowInstructionsDialog] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<TeacherDomain | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [orgAllowsDomains, setOrgAllowsDomains] = useState<boolean | null>(null)

  // Form state
  const [newDomain, setNewDomain] = useState('')
  const [addingDomain, setAddingDomain] = useState(false)

  const siteQuery = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''

  // Fetch domains
  const fetchDomains = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/user/domains${siteQuery}`)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 403) {
          // Teacher's org doesn't allow custom domains or user is not a teacher
          setOrgAllowsDomains(false)
          if (data.error?.includes('Only teachers')) {
            router.push('/dashboard')
            return
          }
        }
        throw new Error(data.error || 'Failed to fetch domains')
      }

      setDomains(data.domains)
      setOrgAllowsDomains(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchDomains()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, siteQuery])

  // Add domain
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setAddingDomain(true)

    try {
      const response = await fetch('/api/user/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain, siteId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add domain')
      }

      setDomains([...domains, data.domain])
      setSelectedDomain(data.domain)
      setShowAddDialog(false)
      setShowInstructionsDialog(true)
      setNewDomain('')
      setSuccess('Domain added. Add the two DNS records below, then click Verify.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setAddingDomain(false)
    }
  }

  // Verify domain
  const handleVerifyDomain = async (domain: TeacherDomain) => {
    setError('')
    setSuccess('')
    setVerifying(domain.id)

    try {
      const response = await fetch(
        `/api/user/domains/${domain.id}/verify`,
        { method: 'POST' }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      if (data.success) {
        setDomains(domains.map(d => d.id === domain.id ? data.domain : d))
        setSuccess(data.message)
      } else {
        setError(data.message || 'Verification failed')
        setSelectedDomain(domain)
        setShowInstructionsDialog(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setVerifying(null)
    }
  }

  // Delete domain
  const handleDeleteDomain = async (domain: TeacherDomain) => {
    dialog.showConfirm(`Are you sure you want to remove "${domain.domain}"?`, async () => {
      setError('')
      setSuccess('')

      try {
        const response = await fetch(
          `/api/user/domains/${domain.id}`,
          { method: 'DELETE' }
        )

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to delete domain')
        }

        setDomains(domains.filter(d => d.id !== domain.id))
        setSuccess('Domain removed successfully')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      }
    }, { destructive: true, title: 'Remove domain', confirmText: 'Remove' })
  }

  // Set primary domain
  const handleSetPrimary = async (domain: TeacherDomain) => {
    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `/api/user/domains/${domain.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPrimary: true }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set primary domain')
      }

      // Update all domains - only the new one should be primary
      setDomains(domains.map(d => ({
        ...d,
        isPrimary: d.id === domain.id,
      })))
      setSuccess(`${domain.domain} is now the primary domain`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading domains...</p>
      </div>
    )
  }

  // Show message if org doesn't allow teacher custom domains
  if (orgAllowsDomains === false) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-4">
          <Link
            href={backUrl}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <Globe className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-3xl font-bold">Custom Domains</h1>
        </div>

        <Card className="p-8 text-center">
          <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">Custom domains are not enabled</p>
          <p className="text-muted-foreground">
            Your organization does not allow teacher custom domains.
            Contact your organization administrator if you need this feature.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={backUrl}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <Globe className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-3xl font-bold">Custom Domains</h1>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Domain
        </Button>
      </div>

      <p className="text-muted-foreground">
        Add custom domains so visitors can access your page directly. Each domain needs two DNS
        records: a TXT record proving ownership, and a CNAME pointing to{' '}
        <code className="font-mono text-xs">{CUSTOM_DOMAIN_TARGET}</code>. Use &quot;DNS setup&quot;
        on a domain for the exact values.
      </p>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>
      )}

      {/* Domains list */}
      <Card className="divide-y">
        {domains.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="mb-2">No custom domains configured</p>
            <p className="text-sm">Add a domain to allow visitors to access your page directly.</p>
          </div>
        ) : (
          domains.map((domain) => (
            <div key={domain.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {domain.isVerified ? (
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{domain.domain}</span>
                    {domain.isPrimary && (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <Star className="h-3 w-3" />
                        Primary
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {domain.isVerified
                      ? `Verified ${domain.verifiedAt ? new Date(domain.verifiedAt).toLocaleDateString() : ''}`
                      : 'Pending verification'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedDomain(domain)
                    setShowInstructionsDialog(true)
                  }}
                  className="gap-1"
                >
                  <Settings2 className="h-4 w-4" />
                  DNS setup
                </Button>
                {!domain.isVerified && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleVerifyDomain(domain)}
                    disabled={verifying === domain.id}
                    className="gap-1"
                  >
                    <RefreshCw className={`h-4 w-4 ${verifying === domain.id ? 'animate-spin' : ''}`} />
                    Verify
                  </Button>
                )}
                {domain.isVerified && !domain.isPrimary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetPrimary(domain)}
                    className="gap-1"
                  >
                    <Star className="h-4 w-4" />
                    Set Primary
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteDomain(domain)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Domain</DialogTitle>
            <DialogDescription>
              Enter the domain you want to use for your page.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddDomain} className="space-y-4">
            <div>
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter your domain without http:// or https://
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addingDomain}>
                {addingDomain ? 'Adding...' : 'Add Domain'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DomainDnsInstructions
        open={showInstructionsDialog}
        onOpenChange={setShowInstructionsDialog}
        domain={selectedDomain?.domain ?? null}
        verificationToken={selectedDomain?.verificationToken ?? null}
        diagnoseUrl={selectedDomain ? `/api/user/domains/${selectedDomain.id}/diagnose` : undefined}
      />

      <AlertDialogModal
        open={dialog.open} onOpenChange={dialog.setOpen}
        type={dialog.type} title={dialog.title} message={dialog.message}
        onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
        confirmText={dialog.confirmText} cancelText={dialog.cancelText}
        destructive={dialog.destructive}
      />
    </div>
  )
}
