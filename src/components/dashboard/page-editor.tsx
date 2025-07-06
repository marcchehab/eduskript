'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MarkdownEditor } from '@/components/dashboard/markdown-editor'
import { FileBrowser } from '@/components/dashboard/file-browser'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { EditModal } from '@/components/dashboard/edit-modal'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { ArrowLeft, Save, Clock, History, Files } from 'lucide-react'
import { useSession } from 'next-auth/react'

interface PageEditorProps {
  script: any
  chapter: any
  page: any
}

export function PageEditor({ script, chapter, page }: PageEditorProps) {
  const [title, setTitle] = useState(page.title || '')
  const [slug, setSlug] = useState(page.slug || '')
  const [content, setContent] = useState(page.content || '')
  const [isPublished, setIsPublished] = useState(page.isPublished || false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const router = useRouter()
  const { data: session } = useSession()

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    setSlug(generateSlug(newTitle))
    setHasUnsavedChanges(true)
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasUnsavedChanges(true)
  }

  const handlePageUpdated = () => {
    // Refresh the page data
    window.location.reload()
  }

  const handleFileInsert = (file: any) => {
    let insertText = ''
    
    // Determine the type of insert based on file extension
    const extension = file.filename.split('.').pop()?.toLowerCase()
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Image
      insertText = `![${file.originalName || file.filename}](${file.url})`
    } else if (['mp4', 'avi', 'mov', 'wmv'].includes(extension || '')) {
      // Video
      insertText = `<video controls>\n  <source src="${file.url}" type="video/${extension}">\n  Your browser does not support the video tag.\n</video>`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Audio
      insertText = `<audio controls>\n  <source src="${file.url}" type="audio/${extension}">\n  Your browser does not support the audio tag.\n</audio>`
    } else {
      // Generic file/download link
      insertText = `[${file.originalName || file.filename}](${file.url})`
    }
    
    // Insert the text at the current cursor position
    setContent((prev: string) => prev + '\n\n' + insertText)
    setHasUnsavedChanges(true)
  }

  const handleSave = async () => {
    if (!title.trim() || !slug.trim()) {
      alert('Title and slug are required')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim(),
          content,
          isPublished
        })
      })

      if (response.ok) {
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
        // Update URL if slug changed
        if (slug !== page.slug) {
          router.replace(`/dashboard/scripts/${script.slug}/chapters/${chapter.slug}/pages/${slug}/edit`)
        }
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to save page')
      }
    } catch (error) {
      console.error('Error saving page:', error)
      alert('Failed to save page')
    }
    setIsSaving(false)
  }

  const handlePublishToggle = () => {
    setIsPublished(!isPublished)
    setHasUnsavedChanges(true)
  }

  // Auto-save every 30 seconds if there are unsaved changes
  useEffect(() => {
    if (hasUnsavedChanges) {
      const timer = setTimeout(() => {
        handleSave()
      }, 30000)
      return () => clearTimeout(timer)
    }
  }, [hasUnsavedChanges, content])

  // Save with Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/scripts/${script.slug}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Script
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">
              {page.title}
            </h1>
            {hasUnsavedChanges && (
              <div className="w-2 h-2 bg-warning rounded-full" title="Unsaved changes" />
            )}
          </div>
          <p className="text-muted-foreground">
            {script.title} → {chapter.title}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <PublishToggle
            type="page"
            itemId={page.id}
            isPublished={page.isPublished}
            onToggle={handlePageUpdated}
            showText={true}
            size="md"
          />
          <EditModal
            type="page"
            item={page}
            onItemUpdated={handlePageUpdated}
          />
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between text-sm text-muted-foreground bg-muted p-3 rounded-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPublished ? 'bg-success' : 'bg-warning'}`} />
            <span>{isPublished ? 'Published' : 'Draft'}</span>
          </div>
          {lastSaved && (
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" />
              <span>Last saved: {lastSaved.toLocaleTimeString()}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <History className="w-3 h-3" />
          <span>Version {page.currentVersion || 1}</span>
        </div>
      </div>

      {/* Files - Collapsible Drawer */}
      <CollapsibleDrawer 
        title="Files" 
        icon={<Files className="w-5 h-5" />}
        defaultOpen={false}
      >
        <FileBrowser 
          chapterId={chapter.id}
          onFileInsert={handleFileInsert}
        />
      </CollapsibleDrawer>

      {/* Content Editor - Full width */}
      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
          <CardDescription>
            Write your content using the markdown editor. Drag files from the Files drawer to insert them. Ctrl+S to save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarkdownEditor
            content={content}
            onChange={handleContentChange}
            onSave={handleSave}
            onFileInsert={handleFileInsert}
            chapterId={chapter.id}
          />
        </CardContent>
      </Card>
    </div>
  )
}
