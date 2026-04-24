'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { VersionHistory } from '@/components/dashboard/version-history'
import { EditModal } from '@/components/dashboard/edit-modal'
import { CreatePageModal } from '@/components/dashboard/create-page-modal'
import { SkriptAccessManager } from '@/components/permissions/SkriptAccessManager'
import { EditorWithMedia, type ExtraManageTab } from '@/components/dashboard/editor-with-media'
import { ArrowLeft, ArrowRightLeft, Save, History, Eye, ClipboardCopy, Check, Shield, Lock, Unlock, Globe, Maximize2, Minimize2, BookA, BookOpen, FileText, FilePenLine, GripVertical, Trash2, Users, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
  const sessionPageSlug = (session?.user as { pageSlug?: string })?.pageSlug
  // The editor only loads for users who have an author relation to this
  // skript (verified server-side), so the session pageSlug always resolves
  // to a valid public URL for the skript via checkSkriptPermissions.
  const { buildPageUrl } = usePublicUrl(sessionPageSlug)
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

  // Update ref when content changes
  useEffect(() => {
    contentRef.current = content
  }, [content])

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

  // The shell handles file/Excalidraw/PDF state. Track shell-driven content
  // changes so we can flip the dirty flag without the shell knowing about it.
  const handleShellContentChange = useCallback((next: string) => {
    setContent(next)
    setHasUnsavedChanges(true)
  }, [])

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

  // Pages tab content (drag-to-reorder list of pages with the current one
  // highlighted) — passed to the shared shell as an extra "Pages" tab.
  const pagesTabContent = (
    <div className="p-3">
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
              {!p.isPublished ? (
                <span className="ml-auto text-xs text-muted-foreground">(draft)</span>
              ) : p.isUnlisted ? (
                <span className="ml-auto text-xs text-muted-foreground">(unlisted)</span>
              ) : null}
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
  )

  // Access tab content — skript-level permission management.
  const accessTabContent = canEdit && userPermissions.canManageAuthors ? (
    <SkriptAccessManager
      skript={skriptForAccessManager}
      userPermissions={userPermissions}
      currentUserId={currentUserId}
      onPermissionChange={() => router.refresh()}
      compact
    />
  ) : (
    <p className="text-sm text-muted-foreground p-3">Only skript owners can manage access.</p>
  )

  const extraTabs: ExtraManageTab[] = [
    { id: 'pages', label: 'Pages', icon: <FileText className="w-3.5 h-3.5" />, content: pagesTabContent, position: 'start' },
    { id: 'access', label: 'Access', icon: <Users className="w-3.5 h-3.5" />, content: accessTabContent },
  ]

  return (
    <div
      className={
        isFullscreen
          // Flex column locks the layout to viewport height so the editor card
          // can flex-1 into the remaining space and let its internal panes
          // (CodeMirror scroller + preview pane) handle their own scroll.
          // No `overflow-auto` here — that would push the toolbar offscreen.
          ? 'fixed inset-0 z-50 bg-background p-6 flex flex-col gap-4'
          : 'space-y-6'
      }
    >

      {/* ── SKRIPT HEADER ── (hidden in fullscreen) */}
      {!isFullscreen && (
        <section className="border rounded-lg">
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
        </section>
      )}

      {/* Shared editor shell — owns manage tabs (Files/Videos + Pages/Access via
          extraTabs), the markdown editor, drag-drop / insertion menu, Excalidraw,
          PDF extraction, and the AI Edit modal. */}
      <EditorWithMedia
        content={content}
        onChange={handleShellContentChange}
        onSave={handleSave}
        skriptId={skript.id}
        pageId={page.id}
        domain={(session?.user as { pageSlug?: string })?.pageSlug || undefined}
        manageLabel="Manage:"
        extraTabs={extraTabs}
        tabStorageKey="eduskript:page-editor-tab"
        aiEdit={{
          target: { mode: 'page', skriptId: skript.id, pageId: page.id },
          targetTitle: page.title,
          targetSubtitle: skript.title,
        }}
        onAIEditApplied={async (newContent) => {
          if (newContent !== undefined) {
            setContent(newContent)
            setHasUnsavedChanges(false)
            setLastSaved(new Date())
          }
          await loadVersions()
          router.refresh()
        }}
        isAdmin={session?.user?.isAdmin}
        fullscreen={isFullscreen}
        metadataSlot={
          <div className="space-y-4">
            {/* Page title row — always visible (Save/Fullscreen toggle live here). */}
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
                  {sessionPageSlug && (
                    page.isPublished && skript.isPublished ? (
                      <Link
                        href={buildPageUrl(skript.slug, page.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        prefetch={false}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          title={page.isUnlisted || skript.isUnlisted
                            ? 'View public page (unlisted — URL works but hidden from sidebar/search)'
                            : 'View public page'}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled
                        title={!skript.isPublished ? 'Publish the skript to view publicly' : 'Publish the page to view publicly'}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    )
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
          </div>
        }
      />

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

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
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
