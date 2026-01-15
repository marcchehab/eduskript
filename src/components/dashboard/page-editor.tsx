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
import { ArrowLeft, Save, History, Files, Eye, Image as ImageIcon, Link2, FileCode, ClipboardCopy, Check, Shield, Lock, Unlock, Maximize2, Minimize2, BookOpen, FileText, Plus } from 'lucide-react'
import { AIEditModal } from '@/components/ai'
import { CreatePageModal } from '@/components/dashboard/create-page-modal'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSession } from 'next-auth/react'
import type { VideoInfo } from '@/lib/skript-files'

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

interface SkriptPage {
  id: string
  title: string
  slug: string
  isPublished: boolean
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
    pages?: SkriptPage[]
  }
  page: {
    id: string
    title: string
    slug: string
    content: string
    isPublished: boolean
    currentVersion?: number
    pageType?: string
    examSettings?: {
      requireSEB?: boolean
    } | null
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

  // Exam settings state
  const [pageType, setPageType] = useState(page.pageType || 'normal')
  const [examSettings, setExamSettings] = useState<{ requireSEB?: boolean }>(
    (page.examSettings as { requireSEB?: boolean }) || { requireSEB: false }
  )
  const [teacherClasses, setTeacherClasses] = useState<Array<{ id: string; name: string }>>([])
  const [unlockedClassIds, setUnlockedClassIds] = useState<string[]>([])
  const [sebLinkCopied, setSebLinkCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [aiEditModalOpen, setAiEditModalOpen] = useState(false)

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
  const [videoList, setVideoList] = useState<VideoInfo[]>([])

  // File insertion menu state (includes drop position and screen coordinates)
  const [insertionMenuFile, setInsertionMenuFile] = useState<{
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    position?: number // Character position in editor
    x?: number // Screen X coordinate
    y?: number // Screen Y coordinate
  } | null>(null)

  // Excalidraw editor state
  const [excalidrawEditorOpen, setExcalidrawEditorOpen] = useState(false)
  const [excalidrawEditFile, setExcalidrawEditFile] = useState<{
    id: string
    name: string
    excalidrawData?: {
      elements: readonly unknown[]
      appState?: unknown
      files?: Record<string, unknown>  // Embedded images
    } | null
    skriptId?: string
  } | null>(null)

  // Fetch file list and videos from API
  const refreshFileList = useCallback(async () => {
    setFileListLoading(true)
    try {
      const response = await fetch(`/api/upload?skriptId=${skript.id}`)
      if (response.ok) {
        const data = await response.json()
        // The new API returns files and videos
        setFileList(data.files || [])
        setVideoList(data.videos || [])
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
    position?: number
  }, insertionType: 'embed' | 'link' | 'sql-editor' = 'embed') => {
    if (file.isDirectory) return // Don't insert directories

    let insertText = ''

    // Determine the type of insert based on file extension and insertion type
    const extension = file.name.split('.').pop()?.toLowerCase()

    // Handle databases specially
    if (['sqlite', 'db'].includes(extension || '')) {
      if (insertionType === 'sql-editor') {
        // SQL Editor block with database reference
        // Use the full filename (human-readable)
        // Start with a query to show all tables - helps users discover the schema
        insertText = `\`\`\`sql editor db="${file.name}"\n-- Show all tables in the database\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\n\`\`\``
      } else {
        // Link to database file
        insertText = `[${file.name}](${file.url || file.name})`
      }
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Images
      if (insertionType === 'embed') {
        // Embedded image
        const altText = file.name.replace(/\.[^/.]+$/, '')
        insertText = `![${altText}](${file.name})`
      } else {
        // Link to image
        insertText = `[${file.name}](${file.url || file.name})`
      }
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

    // Insert the text at the specified position or append to end
    if (file.position !== undefined) {
      setContent((prev: string) => {
        return prev.slice(0, file.position) + insertText + prev.slice(file.position)
      })
    } else {
      setContent((prev: string) => prev + '\n\n' + insertText)
    }
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

  // Handle opening Excalidraw editor for existing file or creating new file
  const handleExcalidrawEdit = async (file: { id: string; name: string; url?: string; skriptId?: string }) => {
    try {
      // If file ID is empty, it's a new file - open editor with empty data
      if (!file.id) {
        setExcalidrawEditFile({
          id: '',
          name: file.name,
          excalidrawData: null, // null means create new
          skriptId: file.skriptId || skript.id
        })
        setExcalidrawEditorOpen(true)
        return
      }

      // Fetch the existing .excalidraw file data with cache busting
      // Use proxy=true to avoid CORS issues with S3 redirects
      const baseUrl = file.url || `/api/files/${file.id}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const fileUrl = `${baseUrl}${separator}proxy=true&v=${Date.now()}`
      const response = await fetch(fileUrl)

      if (response.ok) {
        const text = await response.text()
        let excalidrawData

        // Try parsing as pure JSON first
        try {
          excalidrawData = JSON.parse(text)
        } catch {
          // If not pure JSON, try extracting from Obsidian Excalidraw format
          // Format: markdown with ```json { ... } ``` code block
          const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
          if (jsonMatch) {
            excalidrawData = JSON.parse(jsonMatch[1])
          } else {
            throw new Error('Could not parse Excalidraw data')
          }
        }

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

      if (response.ok) {
        await response.json()

        // Close modal and clear state first
        setExcalidrawEditorOpen(false)
        setExcalidrawEditFile(null)

        // Then refresh file list
        await refreshFileList()
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

  // Fetch teacher's classes for exam unlock checkboxes
  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const response = await fetch('/api/classes')
        if (response.ok) {
          const data = await response.json()
          setTeacherClasses(data.classes || [])
        }
      } catch (error) {
        console.error('Error fetching classes:', error)
      }
    }
    fetchClasses()
  }, [])

  // Fetch unlock status for this page
  const loadUnlocks = useCallback(async () => {
    if (pageType !== 'exam') return
    try {
      const response = await fetch(`/api/pages/${page.id}/unlock`)
      if (response.ok) {
        const data = await response.json()
        const classIds = (data.unlocks || [])
          .filter((u: { classId?: string }) => u.classId)
          .map((u: { classId: string }) => u.classId)
        setUnlockedClassIds(classIds)
      }
    } catch (error) {
      console.error('Error fetching unlocks:', error)
    }
  }, [page.id, pageType])

  useEffect(() => {
    loadUnlocks()
  }, [loadUnlocks])

  // Handle class unlock toggle
  const handleClassUnlockToggle = async (classId: string, unlock: boolean) => {
    try {
      if (unlock) {
        const response = await fetch(`/api/pages/${page.id}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classId })
        })
        if (response.ok) {
          setUnlockedClassIds(prev => [...prev, classId])
        }
      } else {
        const response = await fetch(`/api/pages/${page.id}/unlock?classId=${classId}`, {
          method: 'DELETE'
        })
        if (response.ok) {
          setUnlockedClassIds(prev => prev.filter(id => id !== classId))
        }
      }
    } catch (error) {
      console.error('Error toggling unlock:', error)
    }
  }

  // Copy exam link to clipboard (regular https - students login first, then SEB opens via download button)
  const handleCopySebLink = async () => {
    const userPageSlug = (session?.user as { pageSlug?: string })?.pageSlug
    if (!userPageSlug) return

    const examUrl = `https://${window.location.host}/${userPageSlug}/${collection.slug}/${skript.slug}/${page.slug}`
    await navigator.clipboard.writeText(examUrl)
    setSebLinkCopied(true)
    setTimeout(() => setSebLinkCopied(false), 2000)
  }

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
          isPublished,
          pageType,
          examSettings: pageType === 'exam' ? examSettings : null
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
  }, [title, slug, description, isPublished, pageType, examSettings, page.id, page.slug, collection.slug, skript.slug, router, loadVersions, alert])

  // Handle version restoration
  const handleRestoreVersion = async (versionId: string, versionContent: string) => {
    try {
      const response = await fetch(`/api/pages/${page.id}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        // Update the editor content with restored content
        setContent(versionContent)
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
        // Reload versions to show the new restoration entry
        loadVersions()
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

  // Save with Ctrl+S and Escape to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault()
        setIsFullscreen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, isFullscreen])

  // Load version history on mount
  useEffect(() => {
    loadVersions()
  }, [page.id, loadVersions])

  return (
    <div className={`space-y-6 ${isFullscreen ? 'fixed inset-0 z-50 bg-background p-6 overflow-auto' : ''}`}>
      {/* Header */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
        {/* Column 1: Back button */}
        <Link href={`/dashboard/collections/${collection.slug}`} className={`row-span-2 self-center ${isFullscreen ? 'hidden' : ''}`}>
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
          {/* Page Type selector */}
          <Select
            value={pageType}
            onValueChange={(value) => {
              setPageType(value)
              setHasUnsavedChanges(true)
            }}
          >
            <SelectTrigger className="w-[90px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="exam">Exam</SelectItem>
            </SelectContent>
          </Select>
          <PublishToggle
            type="page"
            itemId={page.id}
            isPublished={page.isPublished}
            onToggle={() => {}} // No-op - PublishToggle manages its own state
            showText={false}
            size="sm"
          />
          {sessionStatus === 'authenticated' && (session?.user as { pageSlug?: string })?.pageSlug && (
            <Link
              href={`/preview/${(session?.user as { pageSlug?: string })?.pageSlug}/${collection.slug}/${skript.slug}/${page.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
            >
              <Button variant="ghost" size="sm" title="Preview page (works for unpublished)">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen editor'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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

      {/* Exam Settings - only shown when page type is exam */}
      {pageType === 'exam' && !isFullscreen && (
        <div className="flex flex-wrap items-start gap-6 p-4 border rounded-lg bg-muted/30">
            {/* Require SEB */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="require-seb"
                checked={examSettings.requireSEB || false}
                onCheckedChange={(checked) => {
                  setExamSettings(prev => ({ ...prev, requireSEB: !!checked }))
                  setHasUnsavedChanges(true)
                }}
              />
              <Label htmlFor="require-seb" className="text-sm flex items-center gap-1.5 cursor-pointer">
                <Shield className="w-4 h-4 text-muted-foreground" />
                Require Safe Exam Browser
              </Label>
            </div>

            {/* Unlock for Classes */}
            {teacherClasses.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Unlock for:</span>
                {teacherClasses.map((cls) => (
                  <div key={cls.id} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`unlock-${cls.id}`}
                      checked={unlockedClassIds.includes(cls.id)}
                      onCheckedChange={(checked) => handleClassUnlockToggle(cls.id, !!checked)}
                    />
                    <Label htmlFor={`unlock-${cls.id}`} className="text-sm cursor-pointer flex items-center gap-1">
                      {unlockedClassIds.includes(cls.id) ? (
                        <Unlock className="w-3.5 h-3.5 text-green-600" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      {cls.name}
                    </Label>
                  </div>
                ))}
              </div>
            )}

            {/* Exam Link - shown when requireSEB is enabled (students login via browser first, then SEB launches) */}
            {examSettings.requireSEB && sessionStatus === 'authenticated' && (session?.user as { pageSlug?: string })?.pageSlug && (
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background px-2 py-1 rounded border font-mono">
                  https://{typeof window !== 'undefined' ? window.location.host : 'example.com'}/{(session?.user as { pageSlug?: string })?.pageSlug}/{collection.slug}/{skript.slug}/{page.slug}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopySebLink}
                  title="Copy exam link"
                >
                  {sebLinkCopied ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <ClipboardCopy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            )}

          {teacherClasses.length === 0 && (
            <span className="text-sm text-muted-foreground italic">
              No classes yet. Create a class to unlock exams for students.
            </span>
          )}
        </div>
      )}

      {/* Skript Overview - Pages and Files (hidden in fullscreen) */}
      {!isFullscreen && (
      <CollapsibleDrawer
        title={skript.title}
        icon={<BookOpen className="w-5 h-5" />}
        defaultOpen={true}
      >
        {/* Pages */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>Pages</span>
            </div>
            <CreatePageModal
              skriptId={skript.id}
              onPageCreated={() => router.refresh()}
            />
          </div>
          <div className="space-y-1">
            {skript.pages && skript.pages.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/collections/${collection.slug}/skripts/${skript.slug}/pages/${p.slug}/edit`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                  p.id === page.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{p.title}</span>
                {!p.isPublished && (
                  <span className="ml-auto text-xs text-muted-foreground">(draft)</span>
                )}
              </Link>
            ))}
          </div>
        </div>

        {/* Files section */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 px-2 mb-2 text-sm font-medium text-muted-foreground">
            <Files className="w-4 h-4" />
            <span>Files</span>
          </div>
          <FileBrowser
            skriptId={skript.id}
            files={fileList}
            loading={fileListLoading}
            onFileSelect={(file) => {
              // Files are inserted via drag and drop, not click
              // This is just for backwards compatibility with other file types
              handleFileInsert(file)
              refreshFileList()
            }}
            onUploadComplete={refreshFileList}
            onFileRenamed={handleFileRenamed}
            onExcalidrawEdit={handleExcalidrawEdit}
          />
        </div>
      </CollapsibleDrawer>
      )}

      {/* Content Editor - Full width */}
      <Card className={isFullscreen ? 'border-0 shadow-none flex-1' : ''}>
        {!isFullscreen && (
        <CardHeader>
          <CardTitle>Content</CardTitle>
          <CardDescription>
            Write your content using the markdown editor. Drag files from the Files drawer to insert them. Ctrl+S to save.
          </CardDescription>
        </CardHeader>
        )}
        <CardContent>
          <MarkdownEditor
            content={content}
            onChange={handleContentChange}
            onSave={handleSave}
            onFileInsert={handleFileInsert}
            onFileDrop={(file, position, screenX, screenY) => {
              // Check if file has multiple insertion options
              const extension = file.name.split('.').pop()?.toLowerCase()
              const hasMultipleOptions =
                ['sqlite', 'db'].includes(extension || '') || // databases: sql-editor or link
                ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '') // images: embed or link

              if (hasMultipleOptions) {
                // Show insertion menu with position and screen coordinates
                setInsertionMenuFile({ ...file, position, x: screenX, y: screenY })
              } else {
                // Insert directly with default option
                handleFileInsert({ ...file, position })
                refreshFileList()
              }
            }}
            skriptId={skript.id}
            pageId={page.id}
            domain={(session?.user as { pageSlug?: string })?.pageSlug || undefined}
            fileList={fileList}
            videoList={videoList}
            fileListLoading={fileListLoading}
            onFileUpload={refreshFileList}
            onAIEdit={() => setAiEditModalOpen(true)}
          />
        </CardContent>
      </Card>

      {/* Version History - Collapsible Drawer (hidden in fullscreen) */}
      {!isFullscreen && (
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
      )}

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
            appState: excalidrawEditFile.excalidrawData?.appState,
            files: excalidrawEditFile.excalidrawData?.files  // Include embedded images
          }}
        />
      )}
      {/* File Insertion Menu - Compact Popup at Cursor */}
      {insertionMenuFile && (() => {
        const extension = insertionMenuFile.name.split('.').pop()?.toLowerCase()
        const isDatabase = ['sqlite', 'db'].includes(extension || '')
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')

        return (
          <>
            {/* Backdrop to close menu */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setInsertionMenuFile(null)}
            />
            {/* Compact menu positioned at cursor */}
            <div
              className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]"
              style={{
                left: `${insertionMenuFile.x || 0}px`,
                top: `${insertionMenuFile.y || 0}px`,
              }}
            >
              {isDatabase && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={() => {
                      handleFileInsert(insertionMenuFile, 'sql-editor')
                      setInsertionMenuFile(null)
                      refreshFileList()
                    }}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    SQL Editor
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={() => {
                      handleFileInsert(insertionMenuFile, 'link')
                      setInsertionMenuFile(null)
                      refreshFileList()
                    }}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    File Link
                  </button>
                </>
              )}
              {isImage && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={() => {
                      handleFileInsert(insertionMenuFile, 'embed')
                      setInsertionMenuFile(null)
                      refreshFileList()
                    }}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Embed Image
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={() => {
                      handleFileInsert(insertionMenuFile, 'link')
                      setInsertionMenuFile(null)
                      refreshFileList()
                    }}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    File Link
                  </button>
                </>
              )}
            </div>
          </>
        )
      })()}

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />

      <AIEditModal
        open={aiEditModalOpen}
        onOpenChange={setAiEditModalOpen}
        skriptId={skript.id}
        skriptTitle={skript.title}
        pageId={page.id}
        pageTitle={page.title}
        currentContent={content}
        onEditsApplied={(newContent) => {
          if (newContent !== undefined) {
            // Update the editor with the new content
            setContent(newContent)
            setHasUnsavedChanges(false)
            setLastSaved(new Date())
          }
          // Refresh to update version history and pages list
          loadVersions()
          router.refresh() // Refresh server data to show new pages in sidebar
        }}
      />
    </div>
  )
}
