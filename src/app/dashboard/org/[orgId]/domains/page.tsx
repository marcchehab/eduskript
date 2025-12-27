'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Globe, Plus, Trash2, CheckCircle, AlertCircle, Star, Copy, RefreshCw, Search } from 'lucide-react'

interface CustomDomain {
  id: string
  domain: string
  organizationId: string
  isPrimary: boolean
  isVerified: boolean
  verificationToken: string | null
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

interface TeacherDomain {
  id: string
  domain: string
  userId: string
  isPrimary: boolean
  isVerified: boolean
  verifiedAt: string | null
  createdAt: string
  user: {
    id: string
    name: string | null
    email: string | null
    pageSlug: string | null
    image: string | null
  }
}

interface VerificationInstructions {
  type: string
  host: string
  value: string
  instructions: string
}

export default function OrgDomainsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()

  // Organization domains state
  const [orgDomains, setOrgDomains] = useState<CustomDomain[]>([])
  const [loadingOrgDomains, setLoadingOrgDomains] = useState(true)

  // Teacher domains state
  const [teacherDomains, setTeacherDomains] = useState<TeacherDomain[]>([])
  const [loadingTeacherDomains, setLoadingTeacherDomains] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Shared state
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showInstructionsDialog, setShowInstructionsDialog] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<CustomDomain | null>(null)
  const [verificationInstructions, setVerificationInstructions] = useState<VerificationInstructions | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)

  // Form state
  const [newDomain, setNewDomain] = useState('')
  const [addingDomain, setAddingDomain] = useState(false)

  // Fetch organization domains
  const fetchOrgDomains = async () => {
    try {
      setLoadingOrgDomains(true)
      const response = await fetch(`/api/organizations/${orgId}/domains`)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 403) {
          router.push('/dashboard')
          return
        }
        throw new Error(data.error || 'Failed to fetch domains')
      }

      setOrgDomains(data.domains)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoadingOrgDomains(false)
    }
  }

  // Fetch teacher domains
  const fetchTeacherDomains = async () => {
    try {
      setLoadingTeacherDomains(true)
      const response = await fetch(`/api/organizations/${orgId}/teacher-domains`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch teacher domains')
      }

      setTeacherDomains(data.domains)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoadingTeacherDomains(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchOrgDomains()
      fetchTeacherDomains()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, orgId])

  // Add organization domain
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setAddingDomain(true)

    try {
      const response = await fetch(`/api/organizations/${orgId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add domain')
      }

      setOrgDomains([...orgDomains, data.domain])
      setVerificationInstructions(data.verificationInstructions)
      setSelectedDomain(data.domain)
      setShowAddDialog(false)
      setShowInstructionsDialog(true)
      setNewDomain('')
      setSuccess('Domain added. Please verify ownership by adding the DNS record.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setAddingDomain(false)
    }
  }

  // Verify organization domain
  const handleVerifyDomain = async (domain: CustomDomain) => {
    setError('')
    setSuccess('')
    setVerifying(domain.id)

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/domains/${domain.id}/verify`,
        { method: 'POST' }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      if (data.success) {
        setOrgDomains(orgDomains.map(d => d.id === domain.id ? data.domain : d))
        setSuccess(data.message)
      } else {
        setError(data.message || 'Verification failed')
        if (data.instructions) {
          setVerificationInstructions(data.instructions)
          setSelectedDomain(domain)
          setShowInstructionsDialog(true)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setVerifying(null)
    }
  }

  // Delete organization domain
  const handleDeleteOrgDomain = async (domain: CustomDomain) => {
    if (!confirm(`Are you sure you want to remove "${domain.domain}"?`)) {
      return
    }

    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/domains/${domain.id}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete domain')
      }

      setOrgDomains(orgDomains.filter(d => d.id !== domain.id))
      setSuccess('Domain removed successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Delete teacher domain
  const handleDeleteTeacherDomain = async (domain: TeacherDomain) => {
    const teacherName = domain.user.name || domain.user.email || 'this teacher'
    if (!confirm(`Are you sure you want to remove "${domain.domain}" from ${teacherName}?`)) {
      return
    }

    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/teacher-domains/${domain.id}`,
        { method: 'DELETE' }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete domain')
      }

      setTeacherDomains(teacherDomains.filter(d => d.id !== domain.id))
      setSuccess(data.message || 'Domain removed successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Set primary organization domain
  const handleSetPrimary = async (domain: CustomDomain) => {
    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/domains/${domain.id}`,
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

      setOrgDomains(orgDomains.map(d => ({
        ...d,
        isPrimary: d.id === domain.id,
      })))
      setSuccess(`${domain.domain} is now the primary domain`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setSuccess('Copied to clipboard!')
    setTimeout(() => setSuccess(''), 2000)
  }

  // Filter teacher domains by search query
  const filteredTeacherDomains = teacherDomains.filter((domain) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      domain.domain.toLowerCase().includes(query) ||
      domain.user.name?.toLowerCase().includes(query) ||
      domain.user.email?.toLowerCase().includes(query) ||
      domain.user.pageSlug?.toLowerCase().includes(query)
    )
  })

  const loading = loadingOrgDomains || loadingTeacherDomains

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading domains...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Globe className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-3xl font-bold">Domains</h1>
      </div>

      <div className="max-w-4xl space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {success && (
          <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>
        )}

        {/* Organization Domains */}
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-xl font-semibold">Organization Domains</h2>
            <div className="flex-1" />
            <Badge variant="outline">{orgDomains.length} domain{orgDomains.length !== 1 ? 's' : ''}</Badge>
            <Button onClick={() => setShowAddDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Domain
            </Button>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Custom domains for your organization&apos;s public page. Visitors can access your organization directly via these domains.
          </p>

          {orgDomains.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border rounded-lg">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No organization domains configured</p>
              <p className="text-sm">Add a domain to allow visitors to access your organization page directly.</p>
            </div>
          ) : (
            <div className="divide-y border rounded-lg">
              {orgDomains.map((domain) => (
                <div key={domain.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {domain.isVerified ? (
                      <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{domain.domain}</span>
                        {domain.isPrimary && (
                          <Badge variant="secondary" className="flex-shrink-0 gap-1">
                            <Star className="h-3 w-3" />
                            Primary
                          </Badge>
                        )}
                        {!domain.isVerified && (
                          <Badge variant="outline" className="text-amber-600">
                            Unverified
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Added {new Date(domain.createdAt).toLocaleDateString()}
                        {domain.isVerified && domain.verifiedAt && (
                          <> &middot; Verified {new Date(domain.verifiedAt).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
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
                      onClick={() => handleDeleteOrgDomain(domain)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Teacher Domains */}
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-xl font-semibold">Teacher Domains</h2>
            <div className="flex-1 max-w-md relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by domain, name, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant="outline">{teacherDomains.length} domain{teacherDomains.length !== 1 ? 's' : ''}</Badge>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Custom domains claimed by teachers in your organization. You can remove domains if needed.
          </p>

          {filteredTeacherDomains.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border rounded-lg">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              {searchQuery ? (
                <p>No domains found matching your search</p>
              ) : (
                <>
                  <p className="mb-2">No teacher custom domains yet</p>
                  <p className="text-sm">Teachers can add custom domains from their settings page.</p>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y border rounded-lg">
              {filteredTeacherDomains.map((domain) => (
                <div key={domain.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {domain.isVerified ? (
                      <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{domain.domain}</span>
                        {domain.isPrimary && (
                          <Badge variant="secondary" className="flex-shrink-0 gap-1">
                            <Star className="h-3 w-3" />
                            Primary
                          </Badge>
                        )}
                        {!domain.isVerified && (
                          <Badge variant="outline" className="text-amber-600">
                            Unverified
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-medium">{domain.user.name || 'Unnamed'}</span>
                        {domain.user.email && (
                          <span className="ml-2 text-xs">({domain.user.email})</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Added {new Date(domain.createdAt).toLocaleDateString()}
                        {domain.isVerified && domain.verifiedAt && (
                          <> &middot; Verified {new Date(domain.verifiedAt).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTeacherDomain(domain)}
                    className="text-destructive hover:text-destructive flex-shrink-0"
                    title="Remove this domain"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Domain</DialogTitle>
            <DialogDescription>
              Enter the domain you want to use for your organization page.
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

      {/* Verification Instructions Dialog */}
      <Dialog open={showInstructionsDialog} onOpenChange={setShowInstructionsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify Domain Ownership</DialogTitle>
            <DialogDescription>
              Add this DNS TXT record to verify you own {selectedDomain?.domain}
            </DialogDescription>
          </DialogHeader>
          {verificationInstructions && (
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Record Type</Label>
                  <div className="font-mono text-sm">{verificationInstructions.type}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Host / Name</Label>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm bg-background px-2 py-1 rounded flex-1 break-all">
                      _eduskript-verify
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard('_eduskript-verify')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Value</Label>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs bg-background px-2 py-1 rounded flex-1 break-all">
                      {verificationInstructions.value}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(verificationInstructions.value)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                DNS changes can take up to 48 hours to propagate. Once you&apos;ve added the record,
                click &quot;Verify&quot; to check if it&apos;s been set up correctly.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowInstructionsDialog(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
