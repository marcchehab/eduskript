'use client'

import { useState, useEffect } from 'react'
import { generateSlug } from '@/lib/markdown'
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
import { Save, GraduationCap, FileText, Trash2 } from 'lucide-react'
import { PageCog, SkriptCog } from '@/components/icons/settings-icons'

interface EditModalProps {
  type: 'skript' | 'page'
  item: {
    id: string
    title: string
    description?: string | null
    slug: string
    /** Pages only: 'normal' | 'exam'. When set, the modal shows a page type switch. */
    pageType?: string
  }
  onItemUpdated: (newSlug?: string) => void
  /** Called with the saved values before onItemUpdated (page editor syncs its state). */
  onSaved?: (values: { title: string; slug: string; description: string | null; pageType?: string }) => void
  /** Rendered at the end of the form. */
  extraContent?: React.ReactNode
  /** Shows a red "Delete …" button at the bottom left; the modal closes first
   *  and the caller confirms + deletes. */
  onDelete?: () => void
  triggerClassName?: string
  buttonText?: string
}

export function EditModal({ type, item, onItemUpdated, onSaved, extraContent, onDelete, triggerClassName, buttonText }: EditModalProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    slug: '',
    pageType: '',
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
        pageType: item.pageType || '',
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
          ...(item.pageType ? { pageType: formData.pageType } : {}),
        })
      })

      if (response.ok) {
        setOpen(false)
        onSaved?.({
          title: formData.title.trim(),
          slug: formData.slug.trim(),
          description: formData.description.trim() || null,
          ...(item.pageType ? { pageType: formData.pageType } : {}),
        })
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
    formData.pageType !== (item.pageType || '')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName} title={`${type === 'skript' ? 'Skript' : 'Page'} settings: title, description, URL, visibility`}>
          {type === 'skript' ? <SkriptCog className="w-4 h-4" /> : <PageCog className="w-4 h-4" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{type === 'skript' ? 'Edit Skript' : 'Page settings'}</DialogTitle>
          <DialogDescription>
            {type === 'page' ? 'Page type, title, URL and description.' : 'Update skript title, URL and description.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {item.pageType && (
              <div className="space-y-2">
                <Label className="block">Page type</Label>
                <div className="flex w-full overflow-hidden rounded-md border text-sm" role="radiogroup" aria-label="Page type">
                  {(['normal', 'exam'] as const).map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={formData.pageType === t}
                      onClick={() => setFormData(prev => ({ ...prev, pageType: t }))}
                      className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 ${i > 0 ? 'border-l' : ''} ${
                        formData.pageType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t === 'exam' ? <GraduationCap className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      {t === 'exam' ? 'Exam' : 'Normal'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formData.pageType === 'exam' ? 'Exam: students take it under exam rules.' : 'Normal: a regular page of the skript.'}
                </p>
              </div>
            )}
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
            {extraContent}
            {error && (
              <div className="text-destructive text-sm">{error}</div>
            )}
          </div>
          <DialogFooter className="sm:items-center">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setOpen(false); onDelete() }}
                className="mr-auto text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete {type}
              </Button>
            )}
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
