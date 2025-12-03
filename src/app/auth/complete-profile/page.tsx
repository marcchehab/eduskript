'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CompleteProfilePage() {
  const { data: session, update: updateSession } = useSession()
  const router = useRouter()

  const [formData, setFormData] = useState({
    name: '',
    pageSlug: ''
  })
  const [initialized, setInitialized] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [checkingSlug, setCheckingSlug] = useState(false)

  // Pre-populate form with session data (only once) and redirect if profile complete
  useEffect(() => {
    if (!session?.user) return

    // Redirect if profile already complete
    if (session.user.needsProfileCompletion === false) {
      router.push('/dashboard')
      return
    }

    // Initialize form data only once
    if (!initialized) {
      // Use a microtask to batch state updates
      queueMicrotask(() => {
        setInitialized(true)
        setFormData({
          name: session.user.name || '',
          pageSlug: session.user.pageSlug || ''
        })
      })
    }
  }, [session, initialized, router])

  // Debounced slug availability check
  const checkSlugAvailability = useCallback(async (slug: string) => {
    if (!slug || slug.length < 3) {
      return null
    }
    try {
      const response = await fetch(`/api/user/check-slug?slug=${encodeURIComponent(slug)}`)
      const data = await response.json()
      return data.available
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!formData.pageSlug || formData.pageSlug.length < 3) {
      // Use microtask to avoid synchronous setState warning
      queueMicrotask(() => setSlugAvailable(null))
      return
    }

    // Use microtask to avoid synchronous setState warning
    queueMicrotask(() => setCheckingSlug(true))
    const timer = setTimeout(async () => {
      const available = await checkSlugAvailability(formData.pageSlug)
      setSlugAvailable(available)
      setCheckingSlug(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [formData.pageSlug, checkSlugAvailability])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target

    if (name === 'pageSlug') {
      // Normalize page slug: lowercase, replace spaces with hyphens, remove invalid chars
      const normalized = value
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      setFormData(prev => ({ ...prev, [name]: normalized }))
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (!formData.name.trim()) {
      setError('Name is required')
      setIsLoading(false)
      return
    }

    if (!formData.pageSlug || formData.pageSlug.length < 3) {
      setError('Page URL must be at least 3 characters')
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          pageSlug: formData.pageSlug
        })
      })

      const data = await response.json()

      if (response.ok) {
        // Update the session to reflect the new profile data
        await updateSession()
        router.push('/dashboard')
      } else {
        setError(data.error || 'Failed to update profile')
      }
    } catch {
      setError('An error occurred. Please try again.')
    }

    setIsLoading(false)
  }

  // Show loading while session is being fetched
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">Complete Your Profile</CardTitle>
          <CardDescription className="text-center">
            Set up your teacher page to start creating educational content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Your Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Enter your name"
                value={formData.name}
                onChange={handleChange}
                required
              />
              <p className="text-sm text-muted-foreground">
                This will be shown on your profile and content.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pageSlug">Page URL</Label>
              <Input
                id="pageSlug"
                name="pageSlug"
                type="text"
                placeholder="your-page-name"
                value={formData.pageSlug}
                onChange={handleChange}
                required
              />
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  eduskript.org/{formData.pageSlug || 'your-page-name'}
                </p>
                {checkingSlug && (
                  <span className="text-sm text-muted-foreground">Checking...</span>
                )}
                {!checkingSlug && slugAvailable === true && formData.pageSlug.length >= 3 && (
                  <span className="text-sm text-green-600">Available</span>
                )}
                {!checkingSlug && slugAvailable === false && (
                  <span className="text-sm text-red-600">Already taken</span>
                )}
              </div>
            </div>

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || slugAvailable === false}
            >
              {isLoading ? 'Saving...' : 'Continue to Dashboard'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
