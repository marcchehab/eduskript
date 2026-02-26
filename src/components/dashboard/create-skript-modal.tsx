'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'

interface CreateSkriptModalProps {
  collectionId?: string
  collections?: Array<{ id: string; title: string }>
  onSkriptCreated: () => void
  onSkriptCreatedWithSlug?: (slug: string) => void
}

export function CreateSkriptModal({ collectionId, collections, onSkriptCreated, onSkriptCreatedWithSlug }: CreateSkriptModalProps) {
  const [selectedCollectionId, setSelectedCollectionId] = useState(collectionId || '')
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    slug: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
      // Auto-generate slug from title if title is being changed
      ...(name === 'title' ? { slug: generateSlug(value) } : {})
    }))
  }

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/skripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          collectionId: collectionId || selectedCollectionId
        })
      })

      if (response.ok) {
        const data = await response.json()
        setFormData({ title: '', description: '', slug: '' })
        setSelectedCollectionId(collectionId || '')
        setOpen(false)
        onSkriptCreated()
        if (data.slug) onSkriptCreatedWithSlug?.(data.slug)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create skript')
      }
    } catch {
      setError('An error occurred. Please try again.')
    }

    setIsLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Skript
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Skript</DialogTitle>
          <DialogDescription>
            Add a new skript to organize your content.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {!collectionId && collections && collections.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="collectionSelect">Collection *</Label>
                <select
                  id="collectionSelect"
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                  required
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select a collection...</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="title">Skript Title *</Label>
              <Input
                id="title"
                name="title"
                placeholder="Enter skript title"
                value={formData.title}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug *</Label>
              <Input
                id="slug"
                name="slug"
                placeholder="url-friendly-name"
                value={formData.slug}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Brief description of this skript"
                value={formData.description}
                onChange={handleChange}
                rows={3}
              />
            </div>
            {error && (
              <div className="text-destructive text-sm">{error}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.title.trim() || !formData.slug.trim() || (!collectionId && !selectedCollectionId)}
            >
              {isLoading ? 'Creating...' : 'Create Skript'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
