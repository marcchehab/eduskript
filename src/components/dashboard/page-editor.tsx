'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useUnsavedChangesGuard } from '@/components/dashboard/unsaved-changes-guard'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { VersionHistory } from '@/components/dashboard/version-history'
import { EditModal } from '@/components/dashboard/edit-modal'
import { ExportSkriptModal } from '@/components/dashboard/export-skript-modal'
import { CreatePageModal } from '@/components/dashboard/create-page-modal'
import { SkriptAccessManager } from '@/components/permissions/SkriptAccessManager'
import { EditorWithMedia, type ExtraManageTab } from '@/components/dashboard/editor-with-media'
import { AIEditChatModal } from '@/components/ai/ai-edit-chat-modal'
import { useIsFreeTeacher } from '@/hooks/use-billing'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { AlertCircle, ArrowLeft, ArrowRightLeft, Save, History, Eye, EyeOff, Check, Shield, Globe, Maximize2, Minimize2, BookA, BookOpen, FileText, FilePenLine, GripVertical, Trash2, Users, Loader2, CircleCheckBig, CircleMinus, Presentation, Link2, GraduationCap, Wand2 } from 'lucide-react'
import { PageCog } from '@/components/icons/settings-icons'
import { ExamStateStepper } from '@/components/exam/exam-state-stepper'
import type { ExamLifecycleState } from '@/lib/exam-state'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
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
import { useQuestStep } from '@/lib/onboarding-quest/use-quest-step'
import { QuestSpotlight } from '@/components/onboarding/quest-spotlight'
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
  pageType?: string
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
    description?: string | null
    content: string
    isPublished: boolean
    isUnlisted?: boolean
    currentVersion?: number
    pageType?: string
    examSettings?: {
      requireSEB?: boolean
    } | null
    presentationPublic?: boolean
  }
  canEdit: boolean
  userPermissions: UserPermissions
  currentUserId: string
}

// The whole-skript AI Edit chat (skript header) is hidden for now — the
// in-editor AI Edit tab covers the page. Kept, not deleted (2026-10-04).
const SHOW_SKRIPT_AI_EDIT = false

export function PageEditor({ skript, page, canEdit, userPermissions, currentUserId }: PageEditorProps) {
  const [title, setTitle] = useState(page.title || '')
  const [slug, setSlug] = useState(page.slug || '')
  const [description, setDescription] = useState(page.description || '')
  const [content, setContent] = useState(page.content || '')
  // Whole-skript AI Edit chat (skript header). Per-page editing is the
  // AI Edit ribbon tab inside the editor.
  const [skriptAiOpen, setSkriptAiOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isFreePlan = useIsFreeTeacher()

  const [isSaving, setIsSaving] = useState(false)
  // Brief "Saved ✓" on the Save button after a successful save (also gives
  // Ctrl+S visible feedback when nothing had changed).
  const [justSaved, setJustSaved] = useState(false)
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const { completeStep } = useQuestStep()

  // Exam settings state
  const [pageType, setPageType] = useState(page.pageType || 'normal')
  const [examSettings, setExamSettings] = useState<{ requireSEB?: boolean; unlockForAll?: boolean }>(
    (page.examSettings as { requireSEB?: boolean; unlockForAll?: boolean }) || { requireSEB: false }
  )
  const [presentationPublic, setPresentationPublic] = useState(page.presentationPublic ?? false)
  const [teacherClasses, setTeacherClasses] = useState<Array<{ id: string; name: string }>>([])
  const [examStates, setExamStates] = useState<Record<string, ExamLifecycleState>>({})
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
    completeStep('rename_skript')
    if (newSlug) {
      router.push(`/dashboard/skripts/${newSlug}/pages/${page.slug}/edit`)
    } else {
      router.refresh()
    }
  }

  const handleDeleteSkript = async () => {
    alert.showConfirm(
      `Delete "${skript.title}" and all its pages?`,
      async () => {
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
      },
      { destructive: true, title: 'Delete skript', confirmText: 'Delete' }
    )
  }

  const handleDeletePage = async (pageId: string, pageTitle: string) => {
    alert.showConfirm(
      `Delete "${pageTitle}"?`,
      async () => {
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
      },
      { destructive: true, title: 'Delete page', confirmText: 'Delete' }
    )
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

  // Fetch the per-class exam lifecycle state for this page (the single source of
  // truth — see lib/exam-state). One request per class; teachers have few.
  const loadExamStates = useCallback(async () => {
    if (pageType !== 'exam' || teacherClasses.length === 0) return
    const entries = await Promise.all(
      teacherClasses.map(async (cls): Promise<[string, ExamLifecycleState]> => {
        try {
          const r = await fetch(`/api/exams/${page.id}/state?classId=${cls.id}`)
          if (!r.ok) return [cls.id, 'hidden']
          const j = await r.json()
          return [cls.id, (j.state ?? 'hidden') as ExamLifecycleState]
        } catch {
          return [cls.id, 'hidden']
        }
      })
    )
    setExamStates(Object.fromEntries(entries))
  }, [page.id, pageType, teacherClasses])

  useEffect(() => {
    loadExamStates()
  }, [loadExamStates])

  // Set a class's exam state. 'hidden' un-assigns; closed/lobby/open assign +
  // control entry. Optimistic, reverts on failure.
  const handleExamStateChange = async (classId: string, state: ExamLifecycleState) => {
    const prev = examStates[classId] ?? 'hidden'
    setExamStates(s => ({ ...s, [classId]: state }))
    try {
      const r = await fetch(`/api/exams/${page.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, state }),
      })
      if (!r.ok) throw new Error('failed')
    } catch (error) {
      console.error('Error setting exam state:', error)
      setExamStates(s => ({ ...s, [classId]: prev }))
    }
  }

  // Copy exam link to clipboard. The exam lives under the /exam/ route
  // (/exam/{site}/{skript}/{page}), not the regular page path — students log in
  // there, then SEB opens via the download button.
  const handleCopySebLink = async () => {
    const userPageSlug = (session?.user as { pageSlug?: string })?.pageSlug
    if (!userPageSlug) return

    const examUrl = `https://${window.location.host}/exam/${userPageSlug}/${skript.slug}/${page.slug}`
    await navigator.clipboard.writeText(examUrl)
    setSebLinkCopied(true)
    setTimeout(() => setSebLinkCopied(false), 2000)
  }

  // Resolves true when the page was saved (used by the unsaved-changes guard).
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!title.trim() || !slug.trim()) {
      alert.showError('Title and slug are required')
      return false
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
          // Empty string now means "no change" service-side; send null
          // so clearing the input in the UI clears the DB column.
          description: description.trim() || null,
          content: contentRef.current,
          pageType,
          examSettings: pageType === 'exam' ? examSettings : null,
          presentationPublic
        })
      })

      if (response.ok) {
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
        setJustSaved(true)
        if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
        justSavedTimer.current = setTimeout(() => setJustSaved(false), 1500)
        // Keep the Pages tab list in sync (it's seeded from server props once)
        setPages(prev => prev.map(p => p.id === page.id ? { ...p, title: title.trim(), slug: slug.trim(), pageType } : p))
        completeStep('edit_page_content')
        // Reload versions to show the new version
        loadVersions()
        // Update URL if slug changed
        if (slug !== originalSlug) {
          const newUrl = `/dashboard/skripts/${skript.slug}/pages/${slug}/edit`
          router.push(newUrl)
          return true // Don't continue with other updates since we're navigating
        }
        setIsSaving(false)
        return true
      } else {
        const data = await response.json()
        alert.showError(data.error || 'Failed to save page')
      }
    } catch (error) {
      console.error('Error saving page:', error)
      alert.showError('Failed to save page')
    }
    setIsSaving(false)
    return false
  }, [title, slug, description, pageType, examSettings, presentationPublic, page.id, page.slug, skript.slug, router, loadVersions, alert, completeStep])

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

  // Ask Save / Discard / Cancel on in-app link clicks, browser warning on unload.
  const unsavedGuard = useUnsavedChangesGuard({ isDirty: hasUnsavedChanges, onSave: handleSave })

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
    <div className="p-3 max-w-3xl">
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
              p.id === page.id ? 'bg-orange-500/10' : 'hover:bg-muted'
            }`}
          >
            <GripVertical className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 hover:opacity-80 cursor-grab ml-1" />
            <Link
              href={`/dashboard/skripts/${skript.slug}/pages/${p.slug}/edit`}
              className={`flex items-center gap-2 flex-1 min-w-0 px-1 py-1.5 ${
                p.id === page.id
                  ? 'text-orange-600 dark:text-orange-400 font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.pageType === 'exam'
                ? <FilePenLine className="w-4 h-4 shrink-0" />
                : <FileText className="w-4 h-4 shrink-0" />}
              <span className="truncate">
                {p.title}
                {p.pageType === 'exam' && <span className="text-muted-foreground font-normal"> (exam)</span>}
              </span>
              {/* Visibility marker — mirrors PublishToggle's icon/color
                  language so the read-only indicator and the interactive
                  toggle speak the same visual vocabulary. */}
              {(() => {
                const state = !p.isPublished ? 'draft' : p.isUnlisted ? 'unlisted' : 'published'
                const Icon = state === 'draft' ? CircleMinus : state === 'unlisted' ? EyeOff : CircleCheckBig
                const color = state === 'draft' ? 'text-red-600 dark:text-red-400' : state === 'unlisted' ? 'text-violet-500' : 'text-success'
                const label = state === 'draft' ? 'Draft' : state === 'unlisted' ? 'Unlisted' : 'Published'
                return (
                  <span className={`shrink-0 ${color}`} title={label} aria-label={label}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                )
              })()}
            </Link>
            {canEdit && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleOpenMoveDialog(p.id) }}
                  className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all shrink-0"
                  title="Move to another skript"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeletePage(p.id, p.title) }}
                  className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-muted transition-all shrink-0"
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
    { id: 'pages', label: 'Pages', icon: <FileText className="w-3.5 h-3.5" />, content: pagesTabContent, position: 'start', title: 'View and reorder this skript\'s pages, or switch to another one' },
    { id: 'access', label: 'Access', icon: <Users className="w-3.5 h-3.5" />, content: accessTabContent, title: 'Manage access of other teachers to this skript' },
  ]

  // Skript-level header, handed to EditorWithMedia as `headerContent` so it
  // shares one bordered card with the manage tab strip below (both are
  // skript-scoped, unlike the page-specific editor further down).
  const skriptHeaderContent = (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Link href="/dashboard/page-builder" className="shrink-0">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xl font-semibold truncate leading-tight">{skript.title}</span>
          {skript.description && (
            <span className="text-xs text-muted-foreground truncate leading-snug">{skript.description}</span>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <PublishToggle
              type="skript"
              itemId={skript.id}
              isPublished={skript.isPublished}
              isUnlisted={skript.isUnlisted}
              onToggle={() => {}}
              showText={false}
              size="sm"
            />
            <QuestSpotlight step="rename_skript" label="Try this!">
              <EditModal
                type="skript"
                item={skript}
                onItemUpdated={handleSkriptUpdated}
              />
            </QuestSpotlight>
            <Link href={`/dashboard/skripts/${skript.slug}/frontpage`}>
              <Button variant="ghost" size="sm" title="Front Page">
                <BookA className="w-4 h-4" />
              </Button>
            </Link>
            {SHOW_SKRIPT_AI_EDIT && <Button
              variant="ghost"
              size="sm"
              onClick={() => setSkriptAiOpen(true)}
              title="AI Edit for the whole skript (several pages, new pages)"
              className="gap-1.5 text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              <Wand2 className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">AI Edit</span>
            </Button>}
            <ExportSkriptModal skriptId={skript.id} skriptTitle={skript.title} />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteSkript}
              disabled={isDeleting}
              title="Delete Skript"
              className="text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* A new skript starts unpublished but its first page is created
          published (dashboard/skripts/[skriptSlug]/page.tsx), so this is
          the state every teacher lands in — not an edge case. The only
          previous signal was a tooltip on a disabled eye icon, which
          nobody sees. */}
      {page.isPublished && !skript.isPublished && (
        <div className="mt-3 mx-3 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            This page is published, but the skript <strong>{skript.title}</strong> is not —
            so nobody can see it yet.
          </span>
          {canEdit && (
            <PublishToggle
              type="skript"
              itemId={skript.id}
              isPublished={skript.isPublished}
              isUnlisted={skript.isUnlisted}
              onToggle={() => router.refresh()}
              showText
              size="sm"
            />
          )}
        </div>
      )}
    </div>
  )

  // Scope labels, rendered by EditorWithMedia as folder-tab notches at the top
  // of the blue skript card and the orange page card, so the two scopes read
  // apart at a glance without a label row above each card.
  const pageLabelContent = (
    <>
      <FilePenLine className="w-3.5 h-3.5" />
      Page
    </>
  )
  const skriptLabelContent = (
    <>
      <BookOpen className="w-3.5 h-3.5" />
      Skript
    </>
  )

  return (
    <div
      className={
        isFullscreen
          // Flex column locks the layout to viewport height so the editor card
          // can flex-1 into the remaining space and let its internal panes
          // (CodeMirror scroller + preview pane) handle their own scroll.
          // No `overflow-auto` here — that would push the toolbar offscreen.
          ? 'fixed inset-0 z-50 bg-background p-3 flex flex-col gap-2'
          // Fills the dashboard's scroll area so the page card (and its
          // editor) take all remaining height — no page scroll, no resize bar.
          : 'flex h-full flex-col gap-4'
      }
    >

      {/* Shared editor shell — owns the skript header + manage tabs
          (Files/Videos + Pages/Access via extraTabs) in one card, the
          markdown editor, drag-drop / insertion menu, Excalidraw, PDF
          extraction, and the AI Edit modal. Header is hidden in fullscreen. */}
      <EditorWithMedia
        content={content}
        onChange={handleShellContentChange}
        onSave={handleSave}
        skriptId={skript.id}
        pageId={page.id}
        domain={(session?.user as { pageSlug?: string })?.pageSlug || undefined}
        headerContent={skriptHeaderContent}
        headerLabel={skriptLabelContent}
        fillHeight
        description={null}
        manageLabel="Manage:"
        extraTabs={extraTabs}
        tabStorageKey="eduskript:page-editor-tab"
        aiEdit={{
          target: { mode: 'page', skriptId: skript.id, pageId: page.id },
          targetTitle: page.title,
          targetSubtitle: skript.title,
        }}
        onAIInlineAccepted={() => completeStep('use_ai_edit')}
        onAIEditApplied={async (newContent) => {
          completeStep('use_ai_edit')
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
        pageLabel={pageLabelContent}
        metadataSlot={
          <div className="space-y-3">
            {/* Page title row — always visible (Save/Fullscreen toggle live here). */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setHasUnsavedChanges(true)
                  }}
                  placeholder="Page title"
                  className="flex-1 min-w-[140px] h-9 text-lg md:text-xl font-semibold border-transparent hover:border-border focus:border-border"
                />
                <div className="flex gap-1 md:gap-2 items-center shrink-0">
                  {(
                    // Description + slug: edited rarely, so they live behind a
                    // settings button instead of taking a full row above the
                    // editor (≈84px measured in the layout test, 2026-10-04).
                    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Page settings: type, description, URL, slides, delete"
                          className={settingsOpen ? 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300' : ''}
                        >
                          <PageCog className="w-4 h-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" style={{ width: 'min(420px, 92vw)' }} className="border-blue-400/70 p-0 shadow-lg dark:border-blue-500/60">
                        <div className="flex items-center gap-3 border-b px-4 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">Page type</span>
                            <span className="block text-xs text-muted-foreground">
                              {pageType === 'exam'
                                ? 'Exam: students take it under exam rules.'
                                : 'Normal: a regular page of the skript.'}
                            </span>
                          </span>
                          <div className="inline-flex shrink-0 overflow-hidden rounded-md border text-xs" role="radiogroup" aria-label="Page type">
                            {(['normal', 'exam'] as const).map((t, i) => (
                              <button
                                key={t}
                                type="button"
                                role="radio"
                                aria-checked={pageType === t}
                                onClick={() => {
                                  if (pageType === t) return
                                  setPageType(t)
                                  setHasUnsavedChanges(true)
                                }}
                                className={`flex items-center gap-1 px-2.5 py-1 ${i > 0 ? 'border-l' : ''} ${
                                  pageType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                {t === 'exam' ? <GraduationCap className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                {t === 'exam' ? 'Exam' : 'Normal'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3 p-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="page-description" className="text-xs font-medium">Description</Label>
                            <Input
                              id="page-description"
                              type="text"
                              value={description}
                              onChange={(e) => {
                                setDescription(e.target.value)
                                setHasUnsavedChanges(true)
                              }}
                              placeholder="One sentence about this page"
                              className="h-8 text-sm"
                            />
                            <p className="text-xs text-muted-foreground">Optional. Shown in search results and link previews.</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="page-slug" className="text-xs font-medium">URL</Label>
                            <div className="flex h-8 items-center overflow-hidden rounded-md border bg-background text-sm focus-within:ring-2 focus-within:ring-ring">
                              <span className="max-w-[45%] shrink-0 truncate border-r bg-muted px-2 py-1.5 text-xs text-muted-foreground" title={`…/${skript.slug}/`}>…/{skript.slug}/</span>
                              <input
                                id="page-slug"
                                type="text"
                                value={slug}
                                onChange={(e) => {
                                  setSlug(e.target.value)
                                  setHasUnsavedChanges(true)
                                }}
                                placeholder="page-slug"
                                className="min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">Description and URL are saved with the page (Save / Ctrl+S).</p>
                        </div>
                        {pageType !== 'exam' && (
                          <label htmlFor="page-presentation" className="flex cursor-pointer items-center gap-3 border-t px-4 py-3">
                            <Presentation className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">Slide presentation</span>
                              <span className="block text-xs text-muted-foreground">
                                {presentationPublic
                                  ? 'On: all viewers can open it as slides.'
                                  : 'Off: only teachers can open it as slides.'}
                              </span>
                            </span>
                            <Switch
                              id="page-presentation"
                              checked={presentationPublic}
                              onCheckedChange={(checked) => {
                                setPresentationPublic(checked)
                                setHasUnsavedChanges(true)
                              }}
                            />
                          </label>
                        )}
                        {canEdit && (
                          <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                            <span className="text-xs text-muted-foreground">Removes the page from this skript.</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setSettingsOpen(false); void handleDeletePage(page.id, page.title) }}
                              className="h-7 shrink-0 gap-1.5 border-red-300 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:border-red-900 dark:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete page
                            </Button>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
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
                      <QuestSpotlight step="view_via_eye_icon" label="Try this!">
                        <Link
                          href={buildPageUrl(skript.slug, page.slug)}
                          prefetch={false}
                          onClick={() => completeStep('view_via_eye_icon')}
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
                      </QuestSpotlight>
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
                  {(
                    <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={`Version history${versions.length ? ` (${versions.length})` : ''}${lastSaved ? ` · Last saved ${lastSaved.toLocaleTimeString()}` : ''}`}
                          className={historyOpen ? 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300' : ''}
                        >
                          <History className="w-4 h-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" onOpenAutoFocus={(e) => e.preventDefault()} className="w-[min(640px,90vw)] max-h-[70vh] overflow-y-auto border-blue-400/70 p-2 shadow-lg dark:border-blue-500/60">
                        <VersionHistory
                          pageId={page.id}
                          versions={versions}
                          currentContent={content}
                          onRestoreVersion={handleRestoreVersion}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                  <QuestSpotlight step="edit_page_content" label="Try this!">
                    {/* Primary + dot when there's something to save; quiet
                        outline "Saved" otherwise, so the state is readable. */}
                    <Button
                      onClick={handleSave}
                      disabled={isSaving}
                      size="sm"
                      variant={hasUnsavedChanges || isSaving ? 'default' : 'outline'}
                      className={`relative ${!hasUnsavedChanges && !isSaving ? (justSaved ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground') : ''}`}
                      title={isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save changes (Ctrl+S)' : 'All changes saved (Ctrl+S)'}
                    >
                      {!hasUnsavedChanges && !isSaving ? <Check className="w-4 h-4 mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
                      {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
                      {hasUnsavedChanges && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-warning rounded-full" />
                      )}
                    </Button>
                  </QuestSpotlight>
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

            </div>

            {pageType === 'exam' && !isFullscreen && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 border rounded-lg bg-muted/30">
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
                {teacherClasses.length === 0 && (
                  <span className="text-sm text-muted-foreground italic">
                    No classes yet. Create a class to unlock exams for students.
                  </span>
                )}

                {/* Actions, pushed to the right */}
                <div className="flex items-center gap-2 ml-auto">
                  {teacherClasses.length > 0 && (() => {
                    const assignedCount = teacherClasses.filter(
                      (cls) => (examStates[cls.id] ?? 'hidden') !== 'hidden',
                    ).length
                    return (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <Users className="w-4 h-4" />
                            Assign to classes
                            {assignedCount > 0 && (
                              <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary tabular-nums">
                                {assignedCount}
                              </span>
                            )}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Assign to classes</DialogTitle>
                            <DialogDescription>
                              Hidden = not assigned · Closed = visible, no entry yet · Lobby = waiting room · Open = students can take it.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="flex flex-col gap-2">
                            {teacherClasses.map((cls) => (
                              <div key={cls.id} className="flex items-center justify-between gap-3">
                                <span className="text-sm">{cls.name}</span>
                                <ExamStateStepper
                                  value={examStates[cls.id] ?? 'hidden'}
                                  onChange={(state) => handleExamStateChange(cls.id, state)}
                                />
                              </div>
                            ))}
                          </div>
                        </DialogContent>
                      </Dialog>
                    )
                  })()}
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <Link href={`/dashboard/exams/${page.id}/grading`}>
                      <GraduationCap className="w-4 h-4" />
                      Grading
                    </Link>
                  </Button>
                  {sessionStatus === 'authenticated' && (session?.user as { pageSlug?: string })?.pageSlug && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopySebLink}
                      title="Copy exam link"
                    >
                      {sebLinkCopied ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Link2 className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            )}

          </div>
        }
      />

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
        onConfirm={alert.onConfirm}
        showCancel={alert.showCancel}
        confirmText={alert.confirmText}
        cancelText={alert.cancelText}
        destructive={alert.destructive}
      />

      {unsavedGuard.dialog}

      {/* Whole-skript AI Edit chat (several pages / new pages). Writes pages
          directly, unlike the in-editor AI Edit tab. */}
      <AIEditChatModal
        open={skriptAiOpen}
        onOpenChange={setSkriptAiOpen}
        target={{ mode: 'page', skriptId: skript.id, pageId: page.id }}
        targetTitle={skript.title}
        targetSubtitle={skript.title}
        currentContent={content}
        locked={isFreePlan}
        skriptScope={{ openPageTitle: page.title }}
        onEditsApplied={async (newContent) => {
          completeStep('use_ai_edit')
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
                  <BookOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.title}</span>
                  {moveInFlight && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto shrink-0" />
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
