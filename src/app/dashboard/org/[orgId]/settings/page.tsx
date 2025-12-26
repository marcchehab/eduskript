'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ChevronLeft, Building2, FileText, Globe, LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { OrgNav } from '@/components/dashboard/org-nav'

interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  requireEmailDomain: string | null
  allowTeacherCustomDomains: boolean
  billingPlan: string
  createdAt: string
  updatedAt: string
  _count: {
    members: number
  }
}

export default function OrgSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logoUrl: '',
    requireEmailDomain: '',
    allowTeacherCustomDomains: false,
  })

  // Fetch organization
  useEffect(() => {
    const fetchOrg = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/organizations/${orgId}`)
        const data = await response.json()

        if (!response.ok) {
          if (response.status === 403) {
            router.push('/dashboard')
            return
          }
          throw new Error(data.error || 'Failed to fetch organization')
        }

        setOrganization(data.organization)
        setFormData({
          name: data.organization.name,
          description: data.organization.description || '',
          logoUrl: data.organization.logoUrl || '',
          requireEmailDomain: data.organization.requireEmailDomain || '',
          allowTeacherCustomDomains: data.organization.allowTeacherCustomDomains || false,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (session) {
      fetchOrg()
    }
  }, [session, orgId, router])

  // Save settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)

    try {
      const response = await fetch(`/api/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          logoUrl: formData.logoUrl || null,
          requireEmailDomain: formData.requireEmailDomain || null,
          allowTeacherCustomDomains: formData.allowTeacherCustomDomains,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update settings')
      }

      setOrganization(data.organization)
      setSuccess('Settings saved successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading settings...</p>
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Organization not found</p>
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
        <h1 className="text-3xl font-bold">{organization.name}</h1>
      </div>

      <OrgNav orgId={orgId} active="settings" />

      <div className="max-w-2xl">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>
      )}

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Organization Settings</h2>
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <Label htmlFor="name">Organization Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the organization"
            />
          </div>

          <div>
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              value={formData.logoUrl}
              onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
              placeholder="https://example.com/logo.png"
            />
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-medium mb-4">Member Settings</h3>

            <div className="space-y-6">
              <div>
                <Label htmlFor="requireEmailDomain">Auto-join Email Domain</Label>
                <Input
                  id="requireEmailDomain"
                  value={formData.requireEmailDomain}
                  onChange={(e) =>
                    setFormData({ ...formData, requireEmailDomain: e.target.value })
                  }
                  placeholder="@school.edu"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Users with this email domain will automatically join this organization on signup.
                  Leave empty to disable.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allowTeacherDomains">Allow Teacher Custom Domains</Label>
                  <p className="text-xs text-muted-foreground">
                    Let teachers in this organization add their own custom domains.
                  </p>
                </div>
                <Switch
                  id="allowTeacherDomains"
                  checked={formData.allowTeacherCustomDomains}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, allowTeacherCustomDomains: checked })
                  }
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-medium mb-4">Organization Info</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Slug:</dt>
                <dd className="font-mono">{organization.slug}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Members:</dt>
                <dd>{organization._count.members}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Plan:</dt>
                <dd className="capitalize">{organization.billingPlan}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Created:</dt>
                <dd>{new Date(organization.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-medium mb-4">Public Page</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Customize what visitors see when they visit your organization&apos;s public page.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/dashboard/org/${orgId}/page-builder`}>
                <Button variant="outline" className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Page Builder
                </Button>
              </Link>
              <Link href={`/dashboard/org/${orgId}/frontpage`}>
                <Button variant="outline" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Edit Front Page
                </Button>
              </Link>
              <Link href={`/dashboard/org/${orgId}/domains`}>
                <Button variant="outline" className="gap-2">
                  <Globe className="h-4 w-4" />
                  Custom Domains
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </div>
  )
}
