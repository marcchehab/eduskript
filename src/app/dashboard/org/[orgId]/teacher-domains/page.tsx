'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Globe, Trash2, CheckCircle, AlertCircle, Star, ChevronLeft, Search, Building2 } from 'lucide-react'
import Link from 'next/link'
import { OrgNav } from '@/components/dashboard/org-nav'

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

export default function OrgTeacherDomainsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [domains, setDomains] = useState<TeacherDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch teacher domains
  const fetchDomains = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/organizations/${orgId}/teacher-domains`)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 403) {
          router.push('/dashboard')
          return
        }
        throw new Error(data.error || 'Failed to fetch teacher domains')
      }

      setDomains(data.domains)
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
  }, [session, orgId])

  // Delete domain
  const handleDeleteDomain = async (domain: TeacherDomain) => {
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

      setDomains(domains.filter(d => d.id !== domain.id))
      setSuccess(data.message || 'Domain removed successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Filter domains by search query
  const filteredDomains = domains.filter((domain) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      domain.domain.toLowerCase().includes(query) ||
      domain.user.name?.toLowerCase().includes(query) ||
      domain.user.email?.toLowerCase().includes(query) ||
      domain.user.pageSlug?.toLowerCase().includes(query)
    )
  })

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading teacher domains...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-3xl font-bold">Organization</h1>
      </div>

      <OrgNav orgId={orgId} active="teacher-domains" />

      <div className="max-w-4xl">
        <p className="text-muted-foreground mb-6">
          View and manage custom domains claimed by teachers in your organization.
          You can remove domains if needed, but cannot edit them.
        </p>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">{error}</div>
        )}

        {success && (
          <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 mb-4">{success}</div>
        )}

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
            <Badge variant="outline">{domains.length} domain{domains.length !== 1 ? 's' : ''}</Badge>
          </div>

          {filteredDomains.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              {searchQuery ? (
                <p>No domains found matching your search</p>
              ) : (
                <>
                  <p className="mb-2">No teacher custom domains yet</p>
                  <p className="text-sm">
                    Teachers can add custom domains from their settings page.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filteredDomains.map((domain) => (
                <div key={domain.id} className="py-4 flex items-center justify-between gap-4">
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
                    onClick={() => handleDeleteDomain(domain)}
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
    </div>
  )
}
