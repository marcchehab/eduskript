'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ChevronLeft, Building2, FileText, Globe, LayoutDashboard, X } from 'lucide-react'
import { OrgIcon } from '@/components/org-icon'
import Link from 'next/link'
import { OrgNav } from '@/components/dashboard/org-nav'

interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  showIcon: boolean
  iconUrl: string | null
  requireEmailDomain: string | null
  allowTeacherCustomDomains: boolean
  sidebarBehavior: string | null
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
  const [teacherCount, setTeacherCount] = useState(0)
  const [studentCount, setStudentCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    showIcon: true,
    iconUrl: '',
    requireEmailDomain: '',
    allowTeacherCustomDomains: false,
    sidebarBehavior: 'contextual' as string,
  })
  const [uploadingIcon, setUploadingIcon] = useState(false)

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
        setTeacherCount(data.teacherCount ?? 0)
        setStudentCount(data.studentCount ?? 0)
        setFormData({
          name: data.organization.name,
          description: data.organization.description || '',
          showIcon: data.organization.showIcon ?? true,
          iconUrl: data.organization.iconUrl || '',
          requireEmailDomain: data.organization.requireEmailDomain || '',
          allowTeacherCustomDomains: data.organization.allowTeacherCustomDomains || false,
          sidebarBehavior: data.organization.sidebarBehavior || 'contextual',
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
          showIcon: formData.showIcon,
          iconUrl: formData.iconUrl || null,
          requireEmailDomain: formData.requireEmailDomain || null,
          allowTeacherCustomDomains: formData.allowTeacherCustomDomains,
          sidebarBehavior: formData.sidebarBehavior,
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

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="showIcon">Show Icon</Label>
                <p className="text-xs text-muted-foreground">
                  Display an icon for your organization
                </p>
              </div>
              <Switch
                id="showIcon"
                checked={formData.showIcon}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, showIcon: checked })
                }
              />
            </div>

            {formData.showIcon && (
              <div className="space-y-3">
                <Label>Organization Icon</Label>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted">
                    <OrgIcon
                      org={{ showIcon: true, iconUrl: formData.iconUrl || null, name: formData.name }}
                      size={32}
                      className="text-muted-foreground"
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    {formData.iconUrl ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Custom icon</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormData({ ...formData, iconUrl: '' })}
                          className="h-6 px-2 text-destructive hover:text-destructive"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Using default icon</span>
                    )}
                    <div>
                      <input
                        type="file"
                        id="iconUpload"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return

                          setUploadingIcon(true)
                          try {
                            const formDataUpload = new FormData()
                            formDataUpload.append('file', file)
                            formDataUpload.append('orgId', orgId)

                            const res = await fetch('/api/upload/org-icon', {
                              method: 'POST',
                              body: formDataUpload,
                            })

                            if (!res.ok) {
                              const data = await res.json()
                              throw new Error(data.error || 'Upload failed')
                            }

                            const { url } = await res.json()
                            setFormData({ ...formData, iconUrl: url })
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to upload icon')
                          } finally {
                            setUploadingIcon(false)
                            e.target.value = ''
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingIcon}
                        onClick={() => document.getElementById('iconUpload')?.click()}
                      >
                        {uploadingIcon ? 'Uploading...' : 'Upload custom icon'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
            <h3 className="text-lg font-medium mb-4">Navigation</h3>
            <div className="space-y-3">
              <Label>Sidebar Navigation Behavior</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="sidebarBehavior"
                    value="contextual"
                    checked={formData.sidebarBehavior === 'contextual'}
                    onChange={(e) => setFormData({ ...formData, sidebarBehavior: e.target.value })}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Contextual</div>
                    <p className="text-xs text-muted-foreground">
                      Show only the current collection in the sidebar when viewing content.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="sidebarBehavior"
                    value="full"
                    checked={formData.sidebarBehavior === 'full'}
                    onChange={(e) => setFormData({ ...formData, sidebarBehavior: e.target.value })}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Full Navigation</div>
                    <p className="text-xs text-muted-foreground">
                      Always show all collections in the sidebar.
                    </p>
                  </div>
                </label>
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
                <dt className="text-muted-foreground">Teachers:</dt>
                <dd>{teacherCount}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Students:</dt>
                <dd>{studentCount}</dd>
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
