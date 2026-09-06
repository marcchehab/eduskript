'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Building2, X, Wand2 } from 'lucide-react'
import { OrgIcon } from '@/components/org-icon'
import Link from 'next/link'
import Image from 'next/image'

interface Organization {
  id: string
  name: string
  slug: string
  description: string | null
  showIcon: boolean
  iconUrl: string | null
  titleStyle: string
  logoUrl: string | null
  requireEmailDomain: string | null
  allowTeacherCustomDomains: boolean
  sidebarBehavior: string | null
  aiSystemPrompt: string | null
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
    titleStyle: 'icon' as 'icon' | 'logo',
    logoUrl: '',
    requireEmailDomain: '',
    allowTeacherCustomDomains: false,
    sidebarBehavior: 'contextual' as string,
    aiSystemPrompt: '',
  })
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [iconDragOver, setIconDragOver] = useState(false)
  const [logoDragOver, setLogoDragOver] = useState(false)

  // Shared by the icon and logo upload widgets (both post to the same
  // content-addressed org-icons endpoint) and by their drag-and-drop handlers.
  const uploadOrgFile = async (
    file: File,
    target: 'iconUrl' | 'logoUrl',
    setUploading: (loading: boolean) => void
  ) => {
    setUploading(true)
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
      setFormData(prev => ({ ...prev, [target]: url }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setUploading(false)
    }
  }

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
          titleStyle: data.organization.titleStyle === 'logo' ? 'logo' : 'icon',
          logoUrl: data.organization.logoUrl || '',
          requireEmailDomain: data.organization.requireEmailDomain || '',
          allowTeacherCustomDomains: data.organization.allowTeacherCustomDomains || false,
          sidebarBehavior: data.organization.sidebarBehavior || 'contextual',
          aiSystemPrompt: data.organization.aiSystemPrompt || '',
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
          titleStyle: formData.titleStyle,
          logoUrl: formData.logoUrl || null,
          requireEmailDomain: formData.requireEmailDomain || null,
          allowTeacherCustomDomains: formData.allowTeacherCustomDomains,
          sidebarBehavior: formData.sidebarBehavior,
          aiSystemPrompt: formData.aiSystemPrompt || null,
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
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-3xl font-bold">{organization.name} Settings</h1>
      </div>

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
                <div
                  className={`flex items-center gap-4 rounded-lg border border-dashed p-2 transition-colors ${
                    iconDragOver ? 'border-primary bg-primary/5' : 'border-transparent'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIconDragOver(true) }}
                  onDragLeave={() => setIconDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIconDragOver(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) uploadOrgFile(file, 'iconUrl', setUploadingIcon)
                  }}
                >
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
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) uploadOrgFile(file, 'iconUrl', setUploadingIcon)
                          e.target.value = ''
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
                    <p className="text-xs text-muted-foreground">Drag and drop onto the icon, or click to browse.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-6 space-y-3">
            <Label>Sidebar Title</Label>
            <p className="text-xs text-muted-foreground">
              How your organization&apos;s name appears at the top of the sidebar on public pages.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${
                  formData.titleStyle === 'icon' ? 'border-primary bg-primary/5' : 'border-input'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="titleStyle"
                    value="icon"
                    checked={formData.titleStyle === 'icon'}
                    onChange={() => setFormData({ ...formData, titleStyle: 'icon' })}
                  />
                  <span className="font-medium text-sm">Icon + Name</span>
                </div>
                <div className="flex items-center gap-2 rounded border bg-muted/30 p-2">
                  <OrgIcon
                    org={{ showIcon: formData.showIcon, iconUrl: formData.iconUrl || null, name: formData.name }}
                    size={20}
                    className="text-muted-foreground shrink-0"
                  />
                  <span className="truncate text-sm font-semibold">{formData.name || 'Organization'}</span>
                </div>
              </label>

              <label
                className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${
                  formData.titleStyle === 'logo' ? 'border-primary bg-primary/5' : 'border-input'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="titleStyle"
                    value="logo"
                    checked={formData.titleStyle === 'logo'}
                    onChange={() => setFormData({ ...formData, titleStyle: 'logo' })}
                  />
                  <span className="font-medium text-sm">Logo</span>
                </div>
                <div
                  className={`relative flex h-9 w-full items-center rounded border border-dashed p-2 transition-colors ${
                    logoDragOver ? 'border-primary bg-primary/10' : 'bg-muted/30'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true) }}
                  onDragLeave={() => setLogoDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setLogoDragOver(false)
                    setFormData(prev => ({ ...prev, titleStyle: 'logo' }))
                    const file = e.dataTransfer.files?.[0]
                    if (file) uploadOrgFile(file, 'logoUrl', setUploadingLogo)
                  }}
                >
                  {formData.logoUrl ? (
                    <Image src={formData.logoUrl} alt="Logo preview" fill className="object-contain object-left" />
                  ) : (
                    <span className="text-xs text-muted-foreground">No logo uploaded</span>
                  )}
                </div>
              </label>
            </div>

            {formData.titleStyle === 'logo' && (
              <div
                className={`flex items-center gap-3 rounded-lg border border-dashed p-2 transition-colors ${
                  logoDragOver ? 'border-primary bg-primary/5' : 'border-transparent'
                }`}
                onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true) }}
                onDragLeave={() => setLogoDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setLogoDragOver(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) uploadOrgFile(file, 'logoUrl', setUploadingLogo)
                }}
              >
                {formData.logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormData({ ...formData, logoUrl: '' })}
                    className="h-8 px-2 text-destructive hover:text-destructive"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                )}
                <input
                  type="file"
                  id="logoUpload"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadOrgFile(file, 'logoUrl', setUploadingLogo)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => document.getElementById('logoUpload')?.click()}
                >
                  {uploadingLogo ? 'Uploading...' : formData.logoUrl ? 'Replace logo' : 'Upload logo'}
                </Button>
                <p className="text-xs text-muted-foreground">Wide image, transparent background recommended. Max 2MB. Drag and drop, or click to browse.</p>
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
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              AI Assistant
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="aiSystemPrompt">Custom System Prompt</Label>
                <Textarea
                  id="aiSystemPrompt"
                  value={formData.aiSystemPrompt}
                  onChange={(e) =>
                    setFormData({ ...formData, aiSystemPrompt: e.target.value })
                  }
                  placeholder="Add custom instructions for the AI assistant that will apply to all teachers in this organization..."
                  rows={5}
                  className="mt-1.5 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This prompt is prepended to all AI interactions for teachers in this organization.
                  Use it to set guidelines, tone, or subject-specific instructions.
                </p>
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
