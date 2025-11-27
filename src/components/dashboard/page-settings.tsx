'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, FileText } from 'lucide-react'
import Link from 'next/link'

export function PageSettings() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [sidebarBehavior, setSidebarBehavior] = useState<string>('contextual')
  const [typographyPreference, setTypographyPreference] = useState<string>('modern')
  const [loading, setLoading] = useState(false)
  const [typographyLoading, setTypographyLoading] = useState(false)
  const [usernameLoading, setUsernameLoading] = useState(false)
  const [username, setUsername] = useState(session?.user?.username || '')
  const [hostnamePrefix, setHostnamePrefix] = useState('eduskript.org/')

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
        const [sidebarResponse, typographyResponse] = await Promise.all([
          fetch('/api/user/sidebar-preference'),
          fetch('/api/user/typography-preference')
        ])

        if (sidebarResponse.ok) {
          const data = await sidebarResponse.json()
          setSidebarBehavior(data.sidebarBehavior || 'contextual')
        }

        if (typographyResponse.ok) {
          const data = await typographyResponse.json()
          setTypographyPreference(data.typographyPreference || 'modern')
        }
      } catch (error) {
        console.error('Error loading preferences:', error)
      }
    }

    if (session?.user) {
      loadPreferences()
      setUsername(session.user.username || '')
    }
  }, [session])

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
        // Simple success feedback - could use a toast library if available
        console.log('Sidebar preference updated successfully')
      } else {
        console.error('Failed to update preference')
        // Revert on error
        const data = await response.json()
        setSidebarBehavior(data.sidebarBehavior || 'contextual')
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
        console.log('Typography preference updated successfully')
        // Update session to reflect new preference
        await update()
        // Refresh to apply new fonts
        router.refresh()
      } else {
        console.error('Failed to update typography preference')
        const data = await response.json()
        setTypographyPreference(data.typographyPreference || 'modern')
      }
    } catch (error) {
      console.error('Failed to update typography preference:', error)
    } finally {
      setTypographyLoading(false)
    }
  }

  const handleUsernameUpdate = async () => {
    setUsernameLoading(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          name: session?.user?.name || 'User' // Include name as it's required by the API
        }),
      })

      if (response.ok) {
        await update() // Update session
        router.refresh() // Refresh page
        console.log('Username updated successfully')
      } else {
        const data = await response.json()
        console.error('Failed to update username:', data.error || 'Unknown error')
        alert(`Failed to update username: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to update username:', error)
      alert('Failed to update username. Please try again.')
    } finally {
      setUsernameLoading(false)
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
        {/* Username Section */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">Username</Label>
            <div className="flex items-center gap-2">
              <div className="flex items-center flex-1">
                <span className="px-3 py-2 bg-muted border border-r-0 border-input rounded-l-md text-muted-foreground text-sm h-10 flex items-center">
                  {hostnamePrefix}
                </span>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, ''))}
                  className="rounded-l-none"
                  placeholder="your-username"
                  pattern="^[a-z0-9\-]+$"
                  required
                />
              </div>
              <Button
                onClick={handleUsernameUpdate}
                disabled={usernameLoading || username === session?.user?.username}
                size="sm"
                className="flex items-center gap-2"
              >
                {usernameLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              This will be your public page URL. Only lowercase letters, numbers, and hyphens allowed.
            </p>
          </div>
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

        {/* Sidebar Behavior Section */}
        <div className="space-y-4 border-t pt-6">
          <Label className="text-sm font-medium">Sidebar Navigation Behavior</Label>
          
          <div className="space-y-3">
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
      </CardContent>
    </Card>
  )
}