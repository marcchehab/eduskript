'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { MarkdownEditor } from '@/components/dashboard/markdown-editor'
import { FileBrowser } from '@/components/dashboard/file-browser'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { VersionHistory } from '@/components/dashboard/version-history'
import { ExcalidrawEditor } from '@/components/dashboard/excalidraw-editor'
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
  skript: {
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

export function PageEditor({ collection, skript, page }: PageEditorProps) {
  const [title, setTitle] = useState(page.title || '')
  const [slug, setSlug] = useState(page.slug || '')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState(page.content || '')
  const [isPublished] = useState(page.isPublished || false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const contentRef = useRef(content)
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const alert = useAlertDialog()

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

  // Excalidraw editor state
  const [excalidrawEditorOpen, setExcalidrawEditorOpen] = useState(false)
  const [excalidrawEditFile, setExcalidrawEditFile] = useState<{
    id: string
    name: string
    excalidrawData?: {
      elements: readonly unknown[]
      appState?: unknown
    }
  } | null>(null)

  // Fetch file list from API
  const refreshFileList = useCallback(async () => {
    setFileListLoading(true)
    try {
      const response = await fetch(`/api/upload?skriptId=${skript.id}`)
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
  }, [skript.id])

  // Fetch file list on mount and when skript changes
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
          const newUrl = `/dashboard/collections/${collection.slug}/skripts/${skript.slug}/pages/${updatedPage.slug}/edit`
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
    } else if (extension === 'excalidraw') {
      // Excalidraw drawing - use image syntax with just filename
      insertText = `![](${file.name})`
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

  // Handle opening Excalidraw editor for existing file
  const handleExcalidrawEdit = async (file: { id: string; name: string; url?: string }) => {
    try {
      // Fetch the existing .excalidraw file data with cache busting
      const baseUrl = file.url || `/api/files/${file.id}`
      const fileUrl = `${baseUrl}?v=${Date.now()}`
      const response = await fetch(fileUrl)

      if (response.ok) {
        const excalidrawData = await response.json()
        setExcalidrawEditFile({
          ...file,
          excalidrawData
        })
        setExcalidrawEditorOpen(true)
      } else {
        throw new Error('Failed to load drawing')
      }
    } catch (error) {
      console.error('Error loading Excalidraw file:', error)
      alert.showError('Failed to load drawing for editing')
    }
  }

  // Handle saving edited Excalidraw drawing
  const handleExcalidrawSave = async (name: string, excalidrawData: string, lightSvg: string, darkSvg: string) => {
    try {
      console.log('[handleExcalidrawSave] Starting save...', { name, skriptId: skript.id })

      // Call the Excalidraw API endpoint
      const response = await fetch('/api/excalidraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          excalidrawData,
          lightSvg,
          darkSvg,
          skriptId: skript.id
        })
      })

      console.log('[handleExcalidrawSave] Response status:', response.status, 'ok:', response.ok)

      if (response.ok) {
        const result = await response.json()
        console.log('[handleExcalidrawSave] Success:', result)
        refreshFileList()
        setExcalidrawEditorOpen(false)
        setExcalidrawEditFile(null)
      } else {
        const error = await response.json()
        console.error('[handleExcalidrawSave] Error response:', error)
        throw new Error(error.error || 'Failed to save drawing')
      }
    } catch (error) {
      console.error('[handleExcalidrawSave] Exception:', error)
      throw error
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
      alert.showError('Title and slug are required')
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
          description: description.trim(),
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
          const newUrl = `/dashboard/collections/${collection.slug}/skripts/${skript.slug}/pages/${slug}/edit`
          router.push(newUrl)
          return // Don't continue with other updates since we're navigating
        }
      } else {
        const data = await response.json()
        alert.showError(data.error || 'Failed to save page')
      }
    } catch (error) {
      console.error('Error saving page:', error)
      alert.showError('Failed to save page')
    }
    setIsSaving(false)
  }, [title, slug, description, isPublished, page.id, page.slug, collection.slug, skript.slug, router, loadVersions, alert])

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
        alert.showSuccess(`Successfully restored to version ${data.restoredFromVersion}`)
      } else {
        const data = await response.json()
        alert.showError(data.error || 'Failed to restore version')
      }
    } catch (error) {
      console.error('Error restoring version:', error)
      alert.showError('Failed to restore version')
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
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
        {/* Column 1: Back button */}
        <Link href={`/dashboard/collections/${collection.slug}`} className="row-span-2 self-center">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>

        {/* Column 2 Row 1: Title */}
        <Input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setHasUnsavedChanges(true)
          }}
          placeholder="Page title"
          className="text-2xl font-semibold border-transparent hover:border-border focus:border-border"
        />

        {/* Column 3 Row 1: Action buttons */}
        <div className="flex gap-2 items-center">
          <PublishToggle
            type="page"
            itemId={page.id}
            isPublished={page.isPublished}
            onToggle={handlePageUpdated}
            showText={false}
            size="sm"
          />
          {sessionStatus === 'authenticated' && (session?.user as { subdomain?: string })?.subdomain && (
            <Link
              href={`/${(session?.user as { subdomain?: string })?.subdomain}/${collection.slug}/${skript.slug}/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
            >
              <Button variant="ghost" size="sm" title="Preview page">
                <Eye className="w-4 h-4" />
              </Button>
            </Link>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="sm"
            className="relative"
            title={isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save changes (Ctrl+S)' : 'No changes to save'}
          >

            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}

            {hasUnsavedChanges && (
              <div className="absolute top-1 right-1 w-2 h-2 bg-warning rounded-full" />
            )}
          </Button>
          
        </div>

        {/* Column 2 Row 2: Description */}
        <Input
          type="text"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            setHasUnsavedChanges(true)
          }}
          placeholder="Description (optional)"
          className="text-sm border-transparent hover:border-border focus:border-border"
        />

        {/* Column 3 Row 2: Slug */}
        <Input
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value)
            setHasUnsavedChanges(true)
          }}
          placeholder="page-slug"
          className="text-sm font-mono border-transparent hover:border-border focus:border-border"
        />
      </div>

      {/* Skript Files - Collapsible Drawer */}
      <CollapsibleDrawer
        title="Skript Files"
        icon={<Files className="w-5 h-5" />}
        defaultOpen={false}
      >
        <FileBrowser
          skriptId={skript.id}
          files={fileList}
          loading={fileListLoading}
          onFileSelect={(file) => {
            handleFileInsert(file)
            refreshFileList()
          }}
          onUploadComplete={refreshFileList}
          onFileRenamed={handleFileRenamed}
          onExcalidrawEdit={handleExcalidrawEdit}
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
            skriptId={skript.id}
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

      {/* Excalidraw Editor Modal */}
      {excalidrawEditFile && (
        <ExcalidrawEditor
          open={excalidrawEditorOpen}
          onClose={() => {
            setExcalidrawEditorOpen(false)
            setExcalidrawEditFile(null)
          }}
          onSave={handleExcalidrawSave}
          skriptId={skript.id}
          initialData={{
            name: excalidrawEditFile.name.replace('.excalidraw', ''),
            elements: excalidrawEditFile.excalidrawData?.elements || [],
            appState: excalidrawEditFile.excalidrawData?.appState
          }}
        />
      )}
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </div>
  )
}
