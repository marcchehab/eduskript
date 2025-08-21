'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { ArrowLeft, Save, History, Files, Eye } from 'lucide-react'
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
  collection: {
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

export function PageEditor({ collection, chapter, page }: PageEditorProps) {
  const [title] = useState(page.title || '')
  const [slug] = useState(page.slug || '')
  const [content, setContent] = useState(page.content || '')
  const [isPublished] = useState(page.isPublished || false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const contentRef = useRef(content)
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()

  // Shared file list state - updated for new file system
  const [fileList, setFileList] = useState<Array<{
    id: string
    name: string
    size?: number
    url?: string
    isDirectory?: boolean
    contentType?: string
    createdAt: Date
    updatedAt: Date
  }>>([])
  const [fileListLoading, setFileListLoading] = useState(false)

  // Fetch file list from API
  const refreshFileList = useCallback(async () => {
    setFileListLoading(true)
    try {
      const response = await fetch(`/api/upload?chapterId=${chapter.id}`)
      if (response.ok) {
        const data = await response.json()
        // The new API returns files directly in the new format
        setFileList(data.files || [])
      }
    } catch (error) {
      console.error('Error fetching file list:', error)
    } finally {
      setFileListLoading(false)
    }
  }, [chapter.id])

  // Fetch file list on mount and when chapter changes
  useEffect(() => {
    refreshFileList()
  }, [refreshFileList])

  // Update ref when content changes
  useEffect(() => {
    contentRef.current = content
  }, [content])

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasUnsavedChanges(true)
  }


  const handlePageUpdated = async () => {
    try {
      // Fetch the updated page data to check if slug changed
      const response = await fetch(`/api/pages/${page.id}`)
      if (response.ok) {
        const updatedPage = await response.json()
        if (updatedPage.slug !== page.slug) {
          // Slug changed, redirect to new URL
          const newUrl = `/dashboard/collections/${collection.slug}/chapters/${chapter.slug}/pages/${updatedPage.slug}/edit`
          router.push(newUrl)
        } else {
          // Just reload the page data
          window.location.reload()
        }
      } else {
        // If API call fails, just reload
        window.location.reload()
      }
    } catch (error) {
      console.error('Error fetching updated page:', error)
      // If fetch fails, just reload
      window.location.reload()
    }
  }

  const handleFileInsert = (file: {
    id: string
    name: string
    url?: string
    isDirectory?: boolean
  }) => {
    if (file.isDirectory) return // Don't insert directories
    
    let insertText = ''
    
    // Determine the type of insert based on file extension
    const extension = file.name.split('.').pop()?.toLowerCase()
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Image - use regular markdown syntax with just filename for path resolution
      const altText = file.name.replace(/\.[^/.]+$/, '')
      insertText = `![${altText}](${file.name})`
    } else if (['mp4', 'avi', 'mov', 'wmv'].includes(extension || '')) {
      // Video - use full URL for non-image files
      insertText = `<video controls>\n  <source src="${file.url || file.name}" type="video/${extension}">\n  Your browser does not support the video tag.\n</video>`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Audio - use full URL for non-image files
      insertText = `<audio controls>\n  <source src="${file.url || file.name}" type="audio/${extension}">\n  Your browser does not support the audio tag.\n</audio>`
    } else {
      // Generic file/download link - use full URL for non-image files
      insertText = `[${file.name}](${file.url || file.name})`
    }
    
    // Insert the text at the current cursor position
    setContent((prev: string) => prev + '\n\n' + insertText)
    setHasUnsavedChanges(true)
  }

  const handleFileRenamed = (oldFilename: string, newFilename: string) => {
    // Update the current editor content to reflect the renamed file
    const updatedContent = content
      // Update image references: ![alt](oldname.jpg) -> ![alt](newname.jpg)
      .replace(
        new RegExp(`!\\[([^\\]]*)\\]\\(${oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), 
        `![$1](${newFilename})`
      )
      // Update link references: [text](oldname.pdf) -> [text](newname.pdf)
      .replace(
        new RegExp(`\\[([^\\]]*)\\]\\(${oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), 
        `[$1](${newFilename})`
      )
      // Update video source references
      .replace(
        new RegExp(`<source src="${oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
        `<source src="${newFilename}"`
      )
    
    if (updatedContent !== content) {
      setContent(updatedContent)
      setHasUnsavedChanges(true)
    }
  }

  // Load version history
  const loadVersions = useCallback(async () => {
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
  }, [page.id])

  const handleSave = useCallback(async () => {
    if (!title.trim() || !slug.trim()) {
      alert('Title and slug are required')
      return
    }

    setIsSaving(true)
    const originalSlug = page.slug
    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim(),
          content: contentRef.current,
          isPublished
        })
      })

      if (response.ok) {
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
        // Reload versions to show the new version
        loadVersions()
        // Update URL if slug changed
        if (slug !== originalSlug) {
          const newUrl = `/dashboard/collections/${collection.slug}/chapters/${chapter.slug}/pages/${slug}/edit`
          router.push(newUrl)
          return // Don't continue with other updates since we're navigating
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
  }, [title, slug, isPublished, page.id, page.slug, collection.slug, chapter.slug, router, loadVersions])

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
  }, [hasUnsavedChanges, handleSave])

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
        <Link href={`/dashboard/collections/${collection.slug}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Collections
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
            {collection.title} → {chapter.title}
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
            buttonText="Edit Page Details"
          />
          {sessionStatus === 'authenticated' && (session?.user as { subdomain?: string })?.subdomain && (
            <Link 
              href={`/${(session?.user as { subdomain?: string })?.subdomain}/${collection.slug}/${chapter.slug}/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
            >
              <Button variant="outline" size="sm">
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
            </Link>
          )}
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Chapter Files - Collapsible Drawer */}
      <CollapsibleDrawer 
        title="Chapter Files" 
        icon={<Files className="w-5 h-5" />}
        defaultOpen={false}
      >
        <FileBrowser 
          chapterId={chapter.id}
          files={fileList}
          loading={fileListLoading}
          onFileSelect={(file) => {
            handleFileInsert(file)
            refreshFileList()
          }}
          onUploadComplete={refreshFileList}
          onFileRenamed={handleFileRenamed}
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
            fileList={fileList}
            fileListLoading={fileListLoading}
            onFileUpload={refreshFileList}
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
