'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { MarkdownEditor } from '@/components/dashboard/markdown-editor'
import { FileBrowser } from '@/components/dashboard/file-browser'
import { VideoBrowser } from '@/components/dashboard/video-browser'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { VersionHistory } from '@/components/dashboard/version-history'
import { ExcalidrawEditor } from '@/components/dashboard/excalidraw-editor'
import { EditModal } from '@/components/dashboard/edit-modal'
import { CreatePageModal } from '@/components/dashboard/create-page-modal'
import { SkriptAccessManager } from '@/components/permissions/SkriptAccessManager'
import { ArrowLeft, ArrowRightLeft, Save, History, Files, Eye, Image as ImageIcon, Link2, FileCode, ClipboardCopy, Check, Shield, Lock, Unlock, Globe, Maximize2, Minimize2, BookA, BookOpen, FileText, FilePenLine, GripVertical, Trash2, Users, Wand2, Film, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AIEditModal } from '@/components/ai'
import { extractAndUploadPdfPages } from '@/lib/pdf-extract'
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
import { usePublicUrl } from '@/hooks/use-public-url'
import type { VideoInfo } from '@/lib/skript-files'
import type { Skript, SkriptAuthor, User, Collection, CollectionSkript } from '@prisma/client'
import type { UserPermissions } from '@/types'

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
  isUnlisted?: boolean
}

type SkriptAuthorWithUser = SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email' | 'image' | 'title'> }
type CollectionSkriptWithCollection = CollectionSkript & { collection: Collection | null }

interface SkriptWithData extends Skript {
  authors: SkriptAuthorWithUser[]
  collectionSkripts: CollectionSkriptWithCollection[]
}

interface PageEditorProps {
  skript: {
    id: string
    slug: string
    title: string
    description: string | null
    isPublished: boolean
    isUnlisted?: boolean
    pages?: SkriptPage[]
    authors: SkriptAuthorWithUser[]
    collectionSkripts: CollectionSkriptWithCollection[]
  }
  page: {
    id: string
    title: string
    slug: string
    content: string
    isPublished: boolean
    isUnlisted?: boolean
    currentVersion?: number
    pageType?: string
    examSettings?: {
      requireSEB?: boolean
    } | null
  }
  canEdit: boolean
  userPermissions: UserPermissions
  currentUserId: string
}

export function PageEditor({ skript, page, canEdit, userPermissions, currentUserId }: PageEditorProps) {
  const [title, setTitle] = useState(page.title || '')
  const [slug, setSlug] = useState(page.slug || '')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState(page.content || '')

  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const contentRef = useRef(content)
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const { buildPreviewUrl } = usePublicUrl((session?.user as { pageSlug?: string })?.pageSlug)
  const alert = useAlertDialog()

  // Exam settings state
  const [pageType, setPageType] = useState(page.pageType || 'normal')
  const [examSettings, setExamSettings] = useState<{ requireSEB?: boolean; unlockForAll?: boolean }>(
    (page.examSettings as { requireSEB?: boolean; unlockForAll?: boolean }) || { requireSEB: false }
  )
  const [teacherClasses, setTeacherClasses] = useState<Array<{ id: string; name: string }>>([])
  const [unlockedClassIds, setUnlockedClassIds] = useState<string[]>([])
  const [sebLinkCopied, setSebLinkCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [aiEditModalOpen, setAiEditModalOpen] = useState(false)
  const [editorHeight, setEditorHeight] = useState(() => {
    if (typeof window === 'undefined') return 500
    const saved = localStorage.getItem('eduskript:editor-height')
    return saved ? parseInt(saved, 10) : 500
  })

  // Persisted skript tab state — null means all collapsed
  const [activeSkriptTab, setActiveSkriptTab] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('eduskript:skript-tab') || null
  })
  const handleEditorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = editorHeight
    const onMouseMove = (e: MouseEvent) => {
      const newHeight = Math.max(200, startHeight + e.clientY - startY)
      setEditorHeight(newHeight)
    }
    const onMouseUp = (e: MouseEvent) => {
      const finalHeight = Math.max(200, startHeight + e.clientY - startY)
      localStorage.setItem('eduskript:editor-height', String(finalHeight))
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [editorHeight])

  const handleSkriptTabClick = useCallback((tab: string) => {
    setActiveSkriptTab(prev => {
      const next = prev === tab ? null : tab
      if (next) {
        localStorage.setItem('eduskript:skript-tab', next)
      } else {
        localStorage.removeItem('eduskript:skript-tab')
      }
      return next
    })
  }, [])

  // Move page dialog state
  const [movePageId, setMovePageId] = useState<string | null>(null)
  const [moveSkripts, setMoveSkripts] = useState<Array<{ id: string; title: string; slug: string }>>([])
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveInFlight, setMoveInFlight] = useState(false)

  // Pages list with local reordering
  const [pages, setPages] = useState<SkriptPage[]>(skript.pages || [])
  const dragIdxRef = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Keep pages in sync when skript.pages changes (e.g. after creating a new page)
  useEffect(() => {
    setPages(skript.pages || [])
  }, [skript.pages])

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
    rawFile?: File // Raw File object for deferred upload (e.g. PDF)
    position?: number // Character position in editor
    x?: number // Screen X coordinate
    y?: number // Screen Y coordinate
  } | null>(null)

  // PDF page extraction state
  const [pdfExtracting, setPdfExtracting] = useState<string | null>(null) // progress message or null

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
          const newUrl = `/dashboard/skripts/${skript.slug}/pages/${updatedPage.slug}/edit`
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

  // Skript-level handlers
  const handleSkriptUpdated = (newSlug?: string) => {
    if (newSlug) {
      router.push(`/dashboard/skripts/${newSlug}/pages/${page.slug}/edit`)
    } else {
      router.refresh()
    }
  }

  const handleDeleteSkript = async () => {
    if (!confirm(`Delete "${skript.title}" and all its pages?`)) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/skripts/${skript.id}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        router.push('/dashboard/page-builder')
      } else {
        alert.showError('Failed to delete skript')
      }
    } catch (error) {
      console.error('Error deleting skript:', error)
      alert.showError('Failed to delete skript')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeletePage = async (pageId: string, pageTitle: string) => {
    if (!confirm(`Delete "${pageTitle}"?`)) return

    try {
      const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' })
      if (res.ok) {
        if (pageId === page.id) {
          router.push(`/dashboard/skripts/${skript.slug}`)
        } else {
          router.refresh()
        }
      } else {
        alert.showError('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert.showError('Failed to delete page')
    }
  }

  const handleFileInsert = (file: {
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    position?: number
  }, insertionType: 'embed' | 'link' | 'sql-editor' | 'pdf-page' = 'embed') => {
    if (file.isDirectory) return // Don't insert directories

    let insertText = ''

    // Determine the type of insert based on file extension and insertion type
    const extension = file.name.split('.').pop()?.toLowerCase()

    // Handle PDFs - embed using custom element, filename resolved at render time
    if (extension === 'pdf' && insertionType === 'pdf-page') {
      insertText = `<pdf src="${file.name}" height="1267"></pdf>`
    } else
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

  const handlePageReorder = async (newPages: SkriptPage[]) => {
    const oldPages = pages
    setPages(newPages)
    try {
      const response = await fetch(`/api/skripts/${skript.id}/reorder-pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: newPages.map((p) => p.id) }),
      })
      if (!response.ok) setPages(oldPages)
    } catch {
      setPages(oldPages)
    }
  }

  const handleOpenMoveDialog = async (pageId: string) => {
    setMovePageId(pageId)
    setMoveLoading(true)
    try {
      const res = await fetch('/api/skripts/list')
      if (res.ok) {
        const data = await res.json()
        // Exclude the current skript
        setMoveSkripts(data.filter((s: { id: string }) => s.id !== skript.id))
      }
    } catch (error) {
      console.error('Error fetching skripts:', error)
    } finally {
      setMoveLoading(false)
    }
  }

  const handleMovePage = async (targetSkriptId: string) => {
    if (!movePageId) return
    setMoveInFlight(true)
    try {
      const res = await fetch('/api/pages/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: movePageId, targetSkriptId }),
      })
      if (res.ok) {
        const data = await res.json()
        setMovePageId(null)
        // If we moved the currently-viewed page, navigate to it in the target skript
        if (movePageId === page.id) {
          router.push(`/dashboard/skripts/${data.targetSkriptSlug}/pages/${data.pageSlug}/edit`)
        } else {
          router.refresh()
        }
      } else {
        const data = await res.json()
        alert.showError(data.error || 'Failed to move page')
      }
    } catch (error) {
      console.error('Error moving page:', error)
      alert.showError('Failed to move page')
    } finally {
      setMoveInFlight(false)
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

      // Fetch the existing .excalidraw file data (direct S3 URL, CORS configured)
      const baseUrl = file.url || `/api/files/${file.id}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const fileUrl = `${baseUrl}${separator}v=${Date.now()}`
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
      }
      // Non-OK is expected during navigation/unmount — don't log
    } catch {
      // Fetch aborted during navigation — expected, ignore
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

    const examUrl = `https://${window.location.host}/${userPageSlug}/${skript.slug}/${page.slug}`
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
          const newUrl = `/dashboard/skripts/${skript.slug}/pages/${slug}/edit`
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
  }, [title, slug, description, pageType, examSettings, page.id, page.slug, skript.slug, router, loadVersions, alert])

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

  // Build the skript object needed by SkriptAccessManager (needs full Skript model shape)
  const skriptForAccessManager: SkriptWithData = {
    id: skript.id,
    slug: skript.slug,
    title: skript.title,
    description: skript.description,
    isPublished: skript.isPublished,
    isUnlisted: skript.isUnlisted ?? false,
    authors: skript.authors,
    collectionSkripts: skript.collectionSkripts,
    // Fill in required Skript model fields with reasonable defaults
    createdAt: new Date(),
    updatedAt: new Date(),
    order: 0,
    skriptType: 'normal',
  } as SkriptWithData

  return (
    <div className={`space-y-6 ${isFullscreen ? 'fixed inset-0 z-50 bg-background p-6 overflow-auto' : ''}`}>

      {/* ── SKRIPT SECTION ── (hidden in fullscreen) */}
      {!isFullscreen && (
        <section className="border rounded-lg">
          {/* Header: back, title, actions, toggle tabs */}
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex items-center justify-between w-[7.5rem] flex-shrink-0">
              <Link href="/dashboard/page-builder">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground">Skript:</span>
              </div>
            </div>
            <span className="text-3xl font-semibold truncate">{skript.title}</span>
            {canEdit && (
              <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                <PublishToggle
                  type="skript"
                  itemId={skript.id}
                  isPublished={skript.isPublished}
                  isUnlisted={skript.isUnlisted}
                  onToggle={() => {}}
                  showText={false}
                  size="sm"
                />
                <EditModal
                  type="skript"
                  item={skript}
                  onItemUpdated={handleSkriptUpdated}
                />
                <Link href={`/dashboard/skripts/${skript.slug}/frontpage`}>
                  <Button variant="ghost" size="sm" title="Front Page">
                    <BookA className="w-4 h-4" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteSkript}
                  disabled={isDeleting}
                  title="Delete Skript"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Toggle tabs — always visible, clicking active tab collapses */}
          <div className="flex items-center border-t">
            <span className="px-3 text-xs text-muted-foreground whitespace-nowrap">Manage skript:</span>
            {[
              { id: 'pages', label: 'Pages', icon: <FileText className="w-3.5 h-3.5" /> },
              { id: 'files', label: 'Files', icon: <Files className="w-3.5 h-3.5" /> },
              { id: 'videos', label: 'Videos', icon: <Film className="w-3.5 h-3.5" /> },
              { id: 'access', label: 'Access', icon: <Users className="w-3.5 h-3.5" /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => handleSkriptTabClick(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeSkriptTab === tab.id
                    ? 'bg-background text-foreground shadow-sm border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground bg-muted/50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content — only shown when a tab is active */}
          {activeSkriptTab === 'pages' && (
            <div className="border-t p-3">
              {pages.map((p, idx) => (
                <Fragment key={p.id}>
                  <div className={`h-0.5 mx-2 rounded transition-colors ${dragOverIdx === idx ? 'bg-primary' : 'bg-transparent'}`} />
                  <div
                    draggable
                    onDragStart={() => { dragIdxRef.current = idx }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      setDragOverIdx(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1)
                    }}
                    onDragLeave={() => setDragOverIdx(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      const fromIdx = dragIdxRef.current
                      const toIdx = dragOverIdx
                      dragIdxRef.current = null
                      setDragOverIdx(null)
                      if (fromIdx === null || toIdx === null || toIdx === fromIdx || toIdx === fromIdx + 1) return
                      const newPages = [...pages]
                      const [moved] = newPages.splice(fromIdx, 1)
                      newPages.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
                      handlePageReorder(newPages)
                    }}
                    onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null) }}
                    className={`group flex items-center gap-1 rounded-md text-sm transition-colors ${
                      p.id === page.id ? 'bg-primary/10' : 'hover:bg-muted'
                    }`}
                  >
                    <GripVertical className="w-4 h-4 flex-shrink-0 text-muted-foreground opacity-40 hover:opacity-80 cursor-grab ml-1" />
                    <Link
                      href={`/dashboard/skripts/${skript.slug}/pages/${p.slug}/edit`}
                      className={`flex items-center gap-2 flex-1 min-w-0 px-1 py-1.5 ${
                        p.id === page.id
                          ? 'text-primary font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{p.title}</span>
                      {!p.isPublished && (
                        <span className="ml-auto text-xs text-muted-foreground">(draft)</span>
                      )}
                    </Link>
                    {canEdit && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenMoveDialog(p.id) }}
                          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all flex-shrink-0"
                          title="Move to another skript"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeletePage(p.id, p.title) }}
                          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-muted transition-all flex-shrink-0"
                          title="Delete page"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </Fragment>
              ))}
              <div className={`h-0.5 mx-2 rounded transition-colors ${dragOverIdx === pages.length ? 'bg-primary' : 'bg-transparent'}`} />
              <CreatePageModal
                skriptId={skript.id}
                onPageCreated={() => router.refresh()}
              />
            </div>
          )}

          {activeSkriptTab === 'files' && (
            <div className="border-t">
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
            </div>
          )}

          {activeSkriptTab === 'videos' && (
            <div className="border-t">
              <VideoBrowser
                videos={videoList}
                loading={fileListLoading}
                isAdmin={session?.user?.isAdmin}
                skriptId={skript.id}
                onVideoAdded={refreshFileList}
                onUploadComplete={() => {
                  refreshFileList()
                  setActiveSkriptTab('videos')
                }}
              />
            </div>
          )}

          {activeSkriptTab === 'access' && (
            <div className="border-t">
              {canEdit && userPermissions.canManageAuthors ? (
                <SkriptAccessManager
                  skript={skriptForAccessManager}
                  userPermissions={userPermissions}
                  currentUserId={currentUserId}
                  onPermissionChange={() => router.refresh()}
                  compact
                />
              ) : (
                <p className="text-sm text-muted-foreground p-3">Only skript owners can manage access.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── PAGE SECTION ── */}
      <section className="space-y-4">
        {/* Page title + description */}
        <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-end gap-1.5 w-[7.5rem] flex-shrink-0">
            <FilePenLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground">Page:</span>
          </div>
          <Input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setHasUnsavedChanges(true)
            }}
            placeholder="Page title"
            className="flex-1 min-w-0 text-2xl font-semibold border-transparent hover:border-border focus:border-border"
          />
          <div className="flex gap-2 items-center flex-shrink-0">
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
              isUnlisted={page.isUnlisted}
              onToggle={() => router.refresh()}
              showText={false}
              size="sm"
            />
            {sessionStatus === 'authenticated' && (session?.user as { pageSlug?: string })?.pageSlug && (
              <Link
                href={buildPreviewUrl(skript.slug, page.slug)}
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
              >
                <Button variant="ghost" size="sm" title="Preview page (works for unpublished)">
                  <Eye className="w-4 h-4" />
                </Button>
              </Link>
            )}
            {canEdit && !isFullscreen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeletePage(page.id, page.title)}
                title="Delete page"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAiEditModalOpen(true)}
              title="AI Edit"
            >
              <Wand2 className="w-4 h-4" />
            </Button>
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
        </div>

        {/* Description + Slug */}
        {!isFullscreen && (
          <div className="flex items-center gap-2">
            <div className="w-[7.5rem] flex-shrink-0" />
            <Input
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setHasUnsavedChanges(true)
              }}
              placeholder="Description (optional)"
              className="flex-1 min-w-0 text-sm border-transparent hover:border-border focus:border-border"
            />
            <Input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setHasUnsavedChanges(true)
              }}
              placeholder="page-slug"
              className="text-sm font-mono border-transparent hover:border-border focus:border-border w-[200px] flex-shrink-0"
            />
          </div>
        )}
        </div>

        {/* Exam Settings */}
        {pageType === 'exam' && !isFullscreen && (
          <div className="flex flex-wrap items-start gap-6 p-4 border rounded-lg bg-muted/30">
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
            <div className="flex items-center gap-2">
              <Checkbox
                id="unlock-for-all"
                checked={examSettings.unlockForAll || false}
                onCheckedChange={(checked) => {
                  setExamSettings(prev => ({ ...prev, unlockForAll: !!checked }))
                  setHasUnsavedChanges(true)
                }}
              />
              <Label htmlFor="unlock-for-all" className="text-sm flex items-center gap-1.5 cursor-pointer">
                <Globe className="w-4 h-4 text-muted-foreground" />
                Unlock for all
              </Label>
            </div>
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
            {examSettings.requireSEB && sessionStatus === 'authenticated' && (session?.user as { pageSlug?: string })?.pageSlug && (
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background px-2 py-1 rounded border font-mono">
                  https://{typeof window !== 'undefined' ? window.location.host : 'example.com'}/{(session?.user as { pageSlug?: string })?.pageSlug}/{skript.slug}/{page.slug}
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

        {/* Content Editor */}
        <Card className={isFullscreen ? 'border-0 shadow-none flex-1 flex flex-col' : ''}>
          {!isFullscreen && (
            <CardHeader className="pb-2">
              <CardDescription>
                Drag files from the Files tab to insert them. Ctrl+S to save.
              </CardDescription>
            </CardHeader>
          )}
          <CardContent className={isFullscreen ? 'flex-1 overflow-hidden' : ''}>
            <div
              style={{ height: isFullscreen ? '100%' : `${editorHeight}px` }}
              className={isFullscreen ? '' : 'overflow-hidden'}
            >
              <MarkdownEditor
                content={content}
                onChange={handleContentChange}
                onSave={handleSave}
                onFileInsert={handleFileInsert}
                onFileDrop={(file, position, screenX, screenY) => {
                  const extension = file.name.split('.').pop()?.toLowerCase()
                  const hasMultipleOptions =
                    ['sqlite', 'db'].includes(extension || '') ||
                    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '') ||
                    extension === 'pdf'

                  if (hasMultipleOptions) {
                    setInsertionMenuFile({ ...file, position, x: screenX, y: screenY })
                  } else {
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
                onExcalidrawEdit={(filename, fileId) => handleExcalidrawEdit({ id: fileId, name: filename })}
              />
            </div>
            {!isFullscreen && (
              <div
                onMouseDown={handleEditorResizeStart}
                className="h-2 cursor-row-resize flex items-center justify-center hover:bg-muted/50 transition-colors -mb-4 mt-1"
              >
                <div className="w-12 h-1 rounded-full bg-muted-foreground/20" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Version History (hidden in fullscreen) */}
        {!isFullscreen && (
          <CollapsibleDrawer
            title={
              <div className="flex items-center gap-2">
                <span>Version history</span>
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
      </section>

      {/* ── MODALS & OVERLAYS ── */}
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
            files: excalidrawEditFile.excalidrawData?.files
          }}
        />
      )}

      {insertionMenuFile && (() => {
        const extension = insertionMenuFile.name.split('.').pop()?.toLowerCase()
        const isDatabase = ['sqlite', 'db'].includes(extension || '')
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')
        const isPdf = extension === 'pdf'

        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setInsertionMenuFile(null)}
            />
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
              {isPdf && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={async () => {
                      const file = insertionMenuFile
                      setInsertionMenuFile(null)

                      // Upload the PDF if it hasn't been uploaded yet
                      if (file.rawFile) {
                        const formData = new FormData()
                        formData.append('file', file.rawFile)
                        formData.append('uploadType', 'skript')
                        formData.append('skriptId', skript.id)
                        try {
                          const response = await fetch('/api/upload', { method: 'POST', body: formData })
                          if (!response.ok) {
                            const err = await response.json().catch(() => ({ error: 'Upload failed' }))
                            throw new Error(err.error || 'Upload failed')
                          }
                          const uploaded = await response.json()
                          if (uploaded.existed) {
                            alert.showInfo('A file with this name already existed in this skript and was embedded. Rename or delete the existing file to re-upload.', 'Existing file used')
                          }
                          handleFileInsert({ ...file, id: uploaded.id, url: uploaded.url }, 'pdf-page')
                        } catch (error) {
                          console.error('PDF upload failed:', error)
                          alert.showError(error instanceof Error ? error.message : 'Failed to upload PDF')
                          return
                        }
                      } else {
                        handleFileInsert(file, 'pdf-page')
                      }
                      refreshFileList()
                    }}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Embed PDF
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={async () => {
                      const file = insertionMenuFile
                      setInsertionMenuFile(null)

                      // Use local object URL from rawFile if available, otherwise fetch from server
                      const pdfUrl = file.rawFile
                        ? URL.createObjectURL(file.rawFile)
                        : (file.url || `/api/files/${file.id}`)
                      setPdfExtracting('Loading PDF…')

                      try {
                        const filenames = await extractAndUploadPdfPages(
                          pdfUrl,
                          file.name,
                          skript.id,
                          (current, total) => setPdfExtracting(`Extracting page ${current}/${total}…`)
                        )

                        const imgTags = filenames.map((name, i) => `![${i + 1}](${name})`).join('\n')
                        const insertText = `<fullwidth class="invert-dark">\n\n${imgTags}\n\n</fullwidth>`

                        if (file.position !== undefined) {
                          setContent((prev: string) => prev.slice(0, file.position) + insertText + prev.slice(file.position))
                        } else {
                          setContent((prev: string) => prev + '\n\n' + insertText)
                        }
                        setHasUnsavedChanges(true)
                        refreshFileList()
                      } catch (error) {
                        console.error('PDF extraction failed:', error)
                        alert.showError(error instanceof Error ? error.message : 'Failed to extract PDF pages')
                      } finally {
                        if (file.rawFile) URL.revokeObjectURL(pdfUrl)
                        setPdfExtracting(null)
                      }
                    }}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Embed pages as images
                  </button>
                </>
              )}
            </div>
          </>
        )
      })()}

      {/* PDF page extraction progress overlay */}
      {pdfExtracting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 bg-popover border border-border rounded-lg px-5 py-3 shadow-lg">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{pdfExtracting}</span>
          </div>
        </div>
      )}

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
        onEditsApplied={async (newContent) => {
          if (newContent !== undefined) {
            setContent(newContent)
            setHasUnsavedChanges(false)
            setLastSaved(new Date())
          }
          await loadVersions()
          router.refresh()
        }}
      />

      {/* Move page to another skript dialog */}
      <Dialog open={movePageId !== null} onOpenChange={(open) => { if (!open) setMovePageId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move page to another skript</DialogTitle>
            <DialogDescription>
              Referenced files will be copied to the target skript.
            </DialogDescription>
          </DialogHeader>
          {moveLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : moveSkripts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No other skripts available.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto -mx-2">
              {moveSkripts.map((s) => (
                <button
                  key={s.id}
                  disabled={moveInFlight}
                  onClick={() => handleMovePage(s.id)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-muted rounded-md transition-colors disabled:opacity-50"
                >
                  <BookOpen className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.title}</span>
                  {moveInFlight && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
