'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, FileText, Upload, X, ExternalLink, Globe, Wand2 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { InlineMarkdown } from '@/components/ui/inline-markdown'

export function PageSettings() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [sidebarBehavior, setSidebarBehavior] = useState<string>('full')
  const [typographyPreference, setTypographyPreference] = useState<string>('modern')
  const [loading, setLoading] = useState(false)
  const [typographyLoading, setTypographyLoading] = useState(false)
  const [pageInfoLoading, setPageInfoLoading] = useState(false)
  const [pageSlug, setPageSlug] = useState(session?.user?.pageSlug || '')
  const [pageName, setPageName] = useState(session?.user?.pageName || '')
  const [pageDescription, setPageDescription] = useState(session?.user?.pageDescription || '')
  const [pageIcon, setPageIcon] = useState(session?.user?.pageIcon || '')
  const [iconUploadLoading, setIconUploadLoading] = useState(false)
  const [hostnamePrefix, setHostnamePrefix] = useState('eduskript.org/')
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [checkingSlug, setCheckingSlug] = useState(false)
  const [isOrgAdmin, setIsOrgAdmin] = useState(false)
  const [aiSystemPrompt, setAiSystemPrompt] = useState('')
  const [aiPromptLoading, setAiPromptLoading] = useState(false)
  const [aiPromptSaved, setAiPromptSaved] = useState(false)

  // Org admins and platform admins can use shorter slugs (min 1 char instead of 3)
  const minSlugLength = (session?.user?.isAdmin || isOrgAdmin) ? 1 : 3

  // Set hostname prefix on client (avoids hydration mismatch)
  useEffect(() => {
    if (window.location.hostname === 'localhost') {
      setHostnamePrefix(`localhost:${window.location.port}/`)
    }
  }, [])

  // Load current preference on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const [sidebarResponse, typographyResponse, orgAdminResponse, aiPromptResponse] = await Promise.all([
          fetch('/api/user/sidebar-preference'),
          fetch('/api/user/typography-preference'),
          fetch('/api/user/is-org-admin'),
          fetch('/api/user/ai-prompt'),
        ])

        if (sidebarResponse.ok) {
          const data = await sidebarResponse.json()
          setSidebarBehavior(data.sidebarBehavior || 'full')
        }

        if (typographyResponse.ok) {
          const data = await typographyResponse.json()
          setTypographyPreference(data.typographyPreference || 'modern')
        }

        if (orgAdminResponse.ok) {
          const data = await orgAdminResponse.json()
          setIsOrgAdmin(data.isOrgAdmin || false)
        }

        if (aiPromptResponse.ok) {
          const data = await aiPromptResponse.json()
          setAiSystemPrompt(data.aiSystemPrompt || '')
        }
      } catch (error) {
        console.error('Error loading preferences:', error)
      }
    }

    if (session?.user) {
      loadPreferences()
      setPageSlug(session.user.pageSlug || '')
      setPageName(session.user.pageName || '')
      setPageDescription(session.user.pageDescription || '')
      setPageIcon(session.user.pageIcon || '')
    }
  }, [session])

  // Debounced slug availability check
  const checkSlugAvailability = useCallback(async (slug: string) => {
    if (!slug || slug.length < minSlugLength) {
      return null
    }
    try {
      const response = await fetch(`/api/user/check-slug?slug=${encodeURIComponent(slug)}`)
      const data = await response.json()
      return data.available
    } catch {
      return null
    }
  }, [minSlugLength])

  useEffect(() => {
    // Don't check if slug hasn't changed from the original
    if (pageSlug === (session?.user?.pageSlug || '')) {
      setSlugAvailable(null)
      setCheckingSlug(false)
      return
    }

    if (!pageSlug || pageSlug.length < minSlugLength) {
      setSlugAvailable(null)
      setCheckingSlug(false)
      return
    }

    setCheckingSlug(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return
      const available = await checkSlugAvailability(pageSlug)
      if (controller.signal.aborted) return
      setSlugAvailable(available)
      setCheckingSlug(false)
    }, 500)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pageSlug, session?.user?.pageSlug, checkSlugAvailability, minSlugLength])

  const handleSidebarBehaviorChange = async (value: string) => {
    setSidebarBehavior(value)
    setLoading(true)

    try {
      const response = await fetch('/api/user/sidebar-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebarBehavior: value }),
      })

      if (response.ok) {
        // Success - preference updated
      } else {
        // Revert on error
        const data = await response.json()
        setSidebarBehavior(data.sidebarBehavior || 'full')
      }
    } catch (error) {
      console.error('Failed to update preference:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTypographyChange = async (value: string) => {
    setTypographyPreference(value)
    setTypographyLoading(true)

    try {
      const response = await fetch('/api/user/typography-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typographyPreference: value }),
      })

      if (response.ok) {
        // Update session to reflect new preference
        await update()
        // Refresh to apply new fonts
        router.refresh()
      } else {
        const data = await response.json()
        setTypographyPreference(data.typographyPreference || 'modern')
      }
    } catch (error) {
      console.error('Failed to update typography preference:', error)
    } finally {
      setTypographyLoading(false)
    }
  }

  const handlePageInfoUpdate = async () => {
    setPageInfoLoading(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageSlug,
          pageName,
          pageDescription,
          pageIcon,
          name: session?.user?.name || 'User' // Include name as it's required by the API
        }),
      })

      if (response.ok) {
        await update() // Update session
        router.refresh() // Refresh page
      } else {
        const data = await response.json()
        // If it's a slug collision, update the UI state
        if (data.error?.includes('slug') || data.error?.includes('taken')) {
          setSlugAvailable(false)
        }
      }
    } catch (error) {
      console.error('Failed to update page info:', error)
    } finally {
      setPageInfoLoading(false)
    }
  }

  // Check if page info has changed
  const hasPageInfoChanges =
    pageSlug !== (session?.user?.pageSlug || '') ||
    pageName !== (session?.user?.pageName || '') ||
    pageDescription !== (session?.user?.pageDescription || '') ||
    pageIcon !== (session?.user?.pageIcon || '')

  // Check if slug is valid for saving
  const slugIsValid = pageSlug.length >= minSlugLength && slugAvailable !== false

  // Handle icon file upload
  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB')
      return
    }

    setIconUploadLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'page-icon')

      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setPageIcon(data.url)
      } else {
        const data = await response.json()
        alert(`Upload failed: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to upload icon:', error)
      alert('Failed to upload icon. Please try again.')
    } finally {
      setIconUploadLoading(false)
    }
  }

  const handleRemoveIcon = () => {
    setPageIcon('')
  }

  const handleAiPromptSave = async () => {
    setAiPromptLoading(true)
    setAiPromptSaved(false)

    try {
      const response = await fetch('/api/user/ai-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiSystemPrompt: aiSystemPrompt || null }),
      })

      if (response.ok) {
        setAiPromptSaved(true)
        setTimeout(() => setAiPromptSaved(false), 2000)
      }
    } catch (error) {
      console.error('Failed to update AI prompt:', error)
    } finally {
      setAiPromptLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Page Settings</CardTitle>
        <CardDescription>
          Customize how your public page appears to visitors
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sidebar Preview */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Sidebar Preview</Label>
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-start gap-3">
              {/* Icon */}
              {pageIcon ? (
                <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-background">
                  <Image
                    src={pageIcon}
                    alt="Page icon"
                    fill
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-muted-foreground text-lg font-heading">
                    {(pageName || session?.user?.name || 'P').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              {/* Name and Description */}
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm truncate">
                  {pageName || session?.user?.name || 'Your Page Name'}
                </h3>
                {pageDescription && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    <InlineMarkdown>{pageDescription}</InlineMarkdown>
                  </p>
                )}
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            This is how your page header will appear in the sidebar on your public page.
          </p>
        </div>

        {/* Page Identity Section */}
        <div className="space-y-4 border-t pt-6">
          {/* Page Icon */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Page Icon</Label>
            <div className="flex items-center gap-4">
              {/* Current icon or placeholder */}
              {pageIcon ? (
                <div className="relative w-16 h-16">
                  <div className="w-full h-full rounded-lg overflow-hidden bg-muted">
                    <Image
                      src={pageIcon}
                      alt="Page icon"
                      fill
                      className="object-cover"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveIcon}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:bg-destructive/90 z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-muted-foreground text-2xl font-heading">
                    {(pageName || session?.user?.name || 'P').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              {/* Upload button */}
              <div>
                <label htmlFor="icon-upload">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={iconUploadLoading}
                    className="cursor-pointer"
                    asChild
                  >
                    <span>
                      {iconUploadLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Icon
                        </>
                      )}
                    </span>
                  </Button>
                </label>
                <input
                  id="icon-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleIconUpload}
                  className="hidden"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Square image recommended. Max 2MB.
            </p>
          </div>

          {/* Page URL */}
          <div className="space-y-2">
            <Label htmlFor="pageSlug" className="text-sm font-medium">Page URL</Label>
            <div className="flex items-center gap-2">
              <div className="flex items-center flex-1">
                <span className="px-3 py-2 bg-muted border border-r-0 border-input rounded-l-md text-muted-foreground text-sm h-10 flex items-center">
                  {hostnamePrefix}
                </span>
                <Input
                  id="pageSlug"
                  type="text"
                  value={pageSlug}
                  onChange={(e) => setPageSlug(e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, ''))}
                  className="rounded-l-none"
                  placeholder="enter-page-slug"
                  pattern="^[a-z0-9\-]+$"
                  required
                />
              </div>
              {session?.user?.pageSlug && (
                <Button
                  variant="outline"
                  size="icon"
                  asChild
                  title="View your public page"
                >
                  <a href={`/${session.user.pageSlug}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {pageSlug
                  ? 'Only lowercase letters, numbers, and hyphens allowed.'
                  : 'Set a page URL to enable your public page.'}
              </p>
              {checkingSlug && (
                <span className="text-sm text-muted-foreground">Checking...</span>
              )}
              {!checkingSlug && slugAvailable === true && pageSlug.length >= minSlugLength && (
                <span className="text-sm text-green-600">Available</span>
              )}
              {!checkingSlug && slugAvailable === false && (
                <span className="text-sm text-red-600">Already taken</span>
              )}
            </div>
          </div>

          {/* Page Name */}
          <div className="space-y-2">
            <Label htmlFor="pageName" className="text-sm font-medium">Page Name</Label>
            <Input
              id="pageName"
              type="text"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder="My Educational Page"
            />
            <p className="text-sm text-muted-foreground">
              The display name shown on your public page. If empty, your profile name will be used.
            </p>
          </div>

          {/* Page Description */}
          <div className="space-y-2">
            <Label htmlFor="pageDescription" className="text-sm font-medium">Page Description</Label>
            <Textarea
              id="pageDescription"
              value={pageDescription}
              onChange={(e) => setPageDescription(e.target.value)}
              placeholder="A brief description of your page and content..."
              rows={3}
            />
            <p className="text-sm text-muted-foreground">
              Shown below your page name in the sidebar. Describe what visitors will find on your page.
            </p>
          </div>

          {/* Save Button */}
          <Button
            onClick={handlePageInfoUpdate}
            disabled={pageInfoLoading || !hasPageInfoChanges || !slugIsValid}
            className="flex items-center gap-2"
          >
            {pageInfoLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Page Info
              </>
            )}
          </Button>
        </div>

        {/* Front Page Section */}
        <div className="space-y-4 border-t pt-6">
          <div>
            <Label className="text-sm font-medium">Front Page</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Customize your public landing page. This is what visitors see when they visit your profile.
            </p>
          </div>
          <Link href="/dashboard/frontpage">
            <Button variant="outline" className="gap-2">
              <FileText className="w-4 h-4" />
              Edit Front Page
            </Button>
          </Link>
        </div>

        {/* Custom Domains Section */}
        <div className="space-y-4 border-t pt-6">
          <div>
            <Label className="text-sm font-medium">Custom Domains</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Add your own domain to access your page directly (e.g., yourdomain.com instead of eduskript.org/{session?.user?.pageSlug}).
            </p>
          </div>
          <Link href="/dashboard/settings/domains">
            <Button variant="outline" className="gap-2">
              <Globe className="w-4 h-4" />
              Manage Custom Domains
            </Button>
          </Link>
        </div>

        {/* Sidebar Behavior Section */}
        <div className="space-y-4 border-t pt-6">
          <Label className="text-sm font-medium">Sidebar Navigation Behavior</Label>
          
          <div className="space-y-3">
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="full"
                name="sidebarBehavior"
                value="full"
                checked={sidebarBehavior === 'full'}
                onChange={(e) => handleSidebarBehaviorChange(e.target.value)}
                disabled={loading}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label htmlFor="full" className="font-normal cursor-pointer">
                  Full Navigation
                </Label>
                <p className="text-sm text-muted-foreground">
                  Always show all collections in the sidebar, regardless of current page.
                  This allows quick navigation between all your content.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="contextual"
                name="sidebarBehavior"
                value="contextual"
                checked={sidebarBehavior === 'contextual'}
                onChange={(e) => handleSidebarBehaviorChange(e.target.value)}
                disabled={loading}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label htmlFor="contextual" className="font-normal cursor-pointer">
                  Contextual Navigation
                </Label>
                <p className="text-sm text-muted-foreground">
                  When viewing content inside a collection, only show that collection in the sidebar.
                  This provides a focused reading experience.
                </p>
              </div>
            </div>
          </div>
          
          {loading && (
            <div className="text-sm text-muted-foreground">
              Updating preference...
            </div>
          )}
        </div>

        {/* Typography Section */}
        <div className="space-y-4 border-t pt-6">
          <div>
            <Label className="text-sm font-medium">Typography Style</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Choose the font style for your public pages
            </p>
          </div>

          <div className="space-y-4">
            {/* Modern Option */}
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="modern"
                name="typographyPreference"
                value="modern"
                checked={typographyPreference === 'modern'}
                onChange={(e) => handleTypographyChange(e.target.value)}
                disabled={typographyLoading}
                className="mt-1"
              />
              <div className="space-y-2 flex-1">
                <Label htmlFor="modern" className="font-normal cursor-pointer">
                  Modern (Roboto Slab)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Clean and contemporary style, great for technical content
                </p>
                {/* Modern Preview */}
                <div className="border rounded-md p-4 bg-background" style={{
                  fontFamily: 'var(--font-modern-body)',
                  fontWeight: 300
                }}>
                  <h3 style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 700,
                    fontSize: '1.25rem',
                    marginBottom: '0.5rem'
                  }}>
                    Sample Heading
                  </h3>
                  <p style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>
                    The quick brown fox jumps over the lazy dog. This is how your content will look with the modern typography style.
                  </p>
                </div>
              </div>
            </div>

            {/* Classic Option */}
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="classic"
                name="typographyPreference"
                value="classic"
                checked={typographyPreference === 'classic'}
                onChange={(e) => handleTypographyChange(e.target.value)}
                disabled={typographyLoading}
                className="mt-1"
              />
              <div className="space-y-2 flex-1">
                <Label htmlFor="classic" className="font-normal cursor-pointer">
                  Classic (EB Garamond)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Elegant and traditional style, ideal for humanities and literature
                </p>
                {/* Classic Preview */}
                <div className="border rounded-md p-4 bg-background" style={{
                  fontFamily: 'var(--font-classic-body)',
                  fontWeight: 400
                }}>
                  <h3 style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 700,
                    fontSize: '1.25rem',
                    marginBottom: '0.5rem'
                  }}>
                    Sample Heading
                  </h3>
                  <p style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>
                    The quick brown fox jumps over the lazy dog. This is how your content will look with the classic typography style.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {typographyLoading && (
            <div className="text-sm text-muted-foreground">
              Updating typography...
            </div>
          )}
        </div>

        {/* AI Assistant Section */}
        <div className="space-y-4 border-t pt-6">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            <Label className="text-sm font-medium">AI Assistant</Label>
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="aiSystemPrompt" className="text-sm">Custom System Prompt</Label>
              <Textarea
                id="aiSystemPrompt"
                value={aiSystemPrompt}
                onChange={(e) => setAiSystemPrompt(e.target.value)}
                placeholder="Add custom instructions for the AI assistant when editing your content..."
                rows={5}
                className="mt-1.5 font-mono text-sm"
              />
              <p className="text-sm text-muted-foreground mt-1">
                This prompt is prepended to all AI interactions when editing your skripts.
                Use it to set your preferred tone, teaching style, or subject-specific guidelines.
              </p>
            </div>
            <Button
              onClick={handleAiPromptSave}
              disabled={aiPromptLoading}
              variant="outline"
              className="flex items-center gap-2"
            >
              {aiPromptLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : aiPromptSaved ? (
                <>
                  <Save className="w-4 h-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save AI Prompt
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}