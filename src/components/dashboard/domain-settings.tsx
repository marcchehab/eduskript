'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trash2, Plus, ExternalLink } from 'lucide-react'

interface CustomDomain {
  id: string
  domain: string
  isActive: boolean
  createdAt: string
}

export function DomainSettings() {
  const [domains, setDomains] = useState<CustomDomain[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchDomains()
  }, [])

  const fetchDomains = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/domains')
      if (response.ok) {
        const data = await response.json()
        setDomains(data)
      }
    } catch (error) {
      console.error('Error fetching domains:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim()) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/domains', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          domain: newDomain.trim().toLowerCase()
        }),
      })

      if (response.ok) {
        const newDomainData = await response.json()
        setDomains(prev => [newDomainData, ...prev])
        setNewDomain('')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to add domain')
      }
    } catch (error) {
      console.error('Error adding domain:', error)
      alert('Failed to add domain')
    } finally {
      setIsSubmitting(false)
    }
  }

  const removeDomain = async (id: string) => {
    if (!confirm('Are you sure you want to remove this domain?')) return

    try {
      const response = await fetch(`/api/domains/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setDomains(prev => prev.filter(d => d.id !== id))
      } else {
        alert('Failed to remove domain')
      }
    } catch (error) {
      console.error('Error removing domain:', error)
      alert('Failed to remove domain')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom Domains</CardTitle>
          <CardDescription>
            Add custom domains to make your educational content available at your own URLs.
            After adding a domain, you&apos;ll need to configure DNS settings with your domain provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add new domain */}
          <form onSubmit={addDomain} className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="domain" className="sr-only">
                Domain
              </Label>
              <Input
                id="domain"
                type="text"
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <Button type="submit" disabled={isSubmitting || !newDomain.trim()}>
              <Plus className="w-4 h-4 mr-2" />
              {isSubmitting ? 'Adding...' : 'Add Domain'}
            </Button>
          </form>

          {/* Domain list */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : domains.length > 0 ? (
            <div className="space-y-2">
              {domains.map((domain) => (
                <div
                  key={domain.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium">
                        {domain.domain}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Added {new Date(domain.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      domain.isActive 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {domain.isActive ? 'Active' : 'Pending'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(`https://${domain.domain}`, '_blank')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDomain(domain.id)}
                      className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No custom domains added yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* DNS Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>DNS Configuration</CardTitle>
          <CardDescription>
            To use your custom domain, add these DNS records with your domain provider:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 rounded-lg">
            <div className="space-y-2 font-mono text-sm">
              <div>Type: <span className="font-semibold">CNAME</span></div>
              <div>Name: <span className="font-semibold">@</span> (or your domain)</div>
              <div>Value: <span className="font-semibold">your-subdomain.eduskript.org</span></div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            Replace &quot;your-subdomain&quot; with your actual subdomain. DNS changes may take up to 24 hours to propagate.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
