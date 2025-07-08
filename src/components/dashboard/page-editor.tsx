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
import { VersionHistory } from '@/components/dashboard/version-history'
import { ArrowLeft, Save, History, Files } from 'lucide-react'
import { useSession } from 'next-auth/react'

interface PageVersion {
  id: string
  content: string
  version: number
  changeLog?: string
  createdAt: string
  author: {
    name?: string
    email: string
  }
}

interface PageEditorProps {
  script: {
    id: string
    slug: string
    title: string
  }
  chapter: {
    id: string
    slug: string
    title: string
  }
  page: {
    id: string
    title: string
    slug: string
    content: string
    isPublished: boolean
    currentVersion?: number
  }
}

export function PageEditor({ script, chapter, page }: PageEditorProps) {
  const [title] = useState(page.title || '')
  const [slug] = useState(page.slug || '')
  const [content, setContent] = useState(page.content || '')
  const [isPublished] = useState(page.isPublished || false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const router = useRouter()
  const { data: session } = useSession()

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasUnsavedChanges(true)
  }

  const handlePageUpdated = () => {
    // Refresh the page data
    window.location.reload()
  }

  const handleFileInsert = (file: {
    filename: string
    url: string
    originalName?: string
  }) => {
    let insertText = ''
    
    // Determine the type of insert based on file extension
    const extension = file.filename.split('.').pop()?.toLowerCase()
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Image - use wiki-style format with just filename for path correction
      insertText = `![[${file.filename}]]`
    } else if (['mp4', 'avi', 'mov', 'wmv'].includes(extension || '')) {
      // Video - use full URL for non-image files
      insertText = `<video controls>\n  <source src="${file.url}" type="video/${extension}">\n  Your browser does not support the video tag.\n</video>`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Audio - use full URL for non-image files
      insertText = `<audio controls>\n  <source src="${file.url}" type="audio/${extension}">\n  Your browser does not support the audio tag.\n</audio>`
    } else {
      // Generic file/download link - use full URL for non-image files
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
        // Reload versions to show the new version
        loadVersions()
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

  // Load version history
  const loadVersions = async () => {
    try {
      const response = await fetch(`/api/pages/${page.id}/versions`)
      if (response.ok) {
        const data = await response.json()
        setVersions(data.versions || [])
      } else {
        console.error('Failed to load versions')
      }
    } catch (error) {
      console.error('Error loading versions:', error)
    }
  }

  // Handle version restoration
  const handleRestoreVersion = async (versionId: string, versionContent: string) => {
    try {
      const response = await fetch(`/api/pages/${page.id}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        const data = await response.json()
        // Update the editor content with restored content
        setContent(versionContent)
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
        // Reload versions to show the new restoration entry
        loadVersions()
        alert(`Successfully restored to version ${data.restoredFromVersion}`)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to restore version')
      }
    } catch (error) {
      console.error('Error restoring version:', error)
      alert('Failed to restore version')
    }
  }

  // Auto-save every 30 seconds if there are unsaved changes
  useEffect(() => {
    if (hasUnsavedChanges) {
      const timer = setTimeout(() => {
        handleSave()
      }, 30000)
      return () => clearTimeout(timer)
    }
  }, [hasUnsavedChanges, content, handleSave])

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
  }, [handleSave])

  // Load version history on mount
  useEffect(() => {
    loadVersions()
  }, [page.id, loadVersions])

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

      {/* Files - Collapsible Drawer */}
      <CollapsibleDrawer 
        title="Files" 
        icon={<Files className="w-5 h-5" />}
        defaultOpen={false}
      >
        <FileBrowser 
          chapterId={chapter.id}
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
            domain={(session?.user as { subdomain?: string })?.subdomain || undefined}
          />
        </CardContent>
      </Card>

      {/* Version History - Collapsible Drawer */}
      <CollapsibleDrawer 
        title={
          <div className="flex items-center gap-2">
            <span>History</span>
            {lastSaved && (
              <span className="text-xs text-muted-foreground font-normal">
                Last saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
        }
        icon={<History className="w-5 h-5" />}
        defaultOpen={false}
      >
        <VersionHistory
          pageId={page.id}
          versions={versions}
          currentContent={content}
          onRestoreVersion={handleRestoreVersion}
        />
      </CollapsibleDrawer>
    </div>
  )
}
