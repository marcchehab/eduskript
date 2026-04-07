'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Edit, Save, Eye, EyeOff, TextCursor } from 'lucide-react'

interface EditModalProps {
  type: 'skript' | 'page'
  item: {
    id: string
    title: string
    description?: string | null
    slug: string
    isPublished: boolean
  }
  onItemUpdated: (newSlug?: string) => void
  triggerClassName?: string
  buttonText?: string
}

export function EditModal({ type, item, onItemUpdated, triggerClassName, buttonText }: EditModalProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    slug: '',
    isPublished: false
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Initialize form data when modal opens
  useEffect(() => {
    if (open && item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        title: item.title || '',
        description: item.description || '',
        slug: item.slug || '',
        isPublished: item.isPublished
      })
       
      setError('')
    }
  }, [open, item])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
      // Auto-generate slug from title if title is being changed
      ...(name === 'title' ? { slug: generateSlug(value) } : {})
    }))
  }

  const handlePublishedChange = (checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      isPublished: checked
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
      const endpoint = type === 'skript' ? `/api/skripts/${item.id}` : `/api/pages/${item.id}`
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          slug: formData.slug.trim(),
          isPublished: formData.isPublished
        })
      })

      if (response.ok) {
        setOpen(false)
        // Pass the new slug if it changed, so parent can navigate
        const slugChanged = formData.slug.trim() !== item.slug
        onItemUpdated(slugChanged ? formData.slug.trim() : undefined)
      } else {
        const data = await response.json()
        setError(data.error || `Failed to update ${type}`)
      }
    } catch {
      setError('An error occurred. Please try again.')
    }

    setIsLoading(false)
  }

  const hasChanges = 
    formData.title !== item.title ||
    formData.description !== (item.description || '') ||
    formData.slug !== item.slug ||
    formData.isPublished !== item.isPublished

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName} title={`Rename ${type}`}>
          <TextCursor className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit {type === 'skript' ? 'Skript' : 'Page'}</DialogTitle>
          <DialogDescription>
            Update {type} details and publication status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">{type === 'skript' ? 'Skript' : 'Page'} Title *</Label>
              <Input
                id="title"
                name="title"
                placeholder={`Enter ${type} title`}
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
                placeholder={`Brief description of this ${type}`}
                value={formData.description}
                onChange={handleChange}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="flex items-center space-x-3">
                {formData.isPublished ? (
                  <Eye className="w-5 h-5 text-success" />
                ) : (
                  <EyeOff className="w-5 h-5 text-warning" />
                )}
                <div>
                  <Label htmlFor="published" className="text-sm font-medium">
                    Published Status
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {formData.isPublished ? 'Visible to the public' : 'Hidden from public view'}
                  </p>
                </div>
              </div>
              <Switch
                id="published"
                checked={formData.isPublished}
                onCheckedChange={handlePublishedChange}
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
              disabled={isLoading || !formData.title.trim() || !formData.slug.trim() || !hasChanges}
            >
              {isLoading ? (
                <>
                  <Save className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
