'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { EditorWithMedia } from '@/components/dashboard/editor-with-media'
import { ArrowLeft, Files, BookA, Building2, Globe } from 'lucide-react'
import { PublishToggle } from '@/components/dashboard/publish-toggle'
import { SaveWithHistory, PageFolderLabel, FULLSCREEN_ROOT_CLASS } from '@/components/dashboard/page-card-parts'
import { useSession } from 'next-auth/react'
import { usePublicUrl } from '@/hooks/use-public-url'

interface FrontPageVersion {
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

interface FrontPageEditorProps {
  // Site-level front pages only: 'user' (a teacher's site) or 'organization'.
  // Skript front pages are edited in PageEditor (front-page mode).
  type: 'user' | 'organization'
  // For a site-scoped user frontpage, pass the specific site's id. When set,
  // the 'user' branch targets /api/sites/[siteId]/frontpage instead of the
  // primary-site endpoint.
  siteId?: string
  frontPage?: {
    id: string
    content: string
    isPublished: boolean
    fileSkriptId?: string | null
  } | null
  organization?: {
    id: string
    slug: string
    name: string
  }
  backUrl: string
  previewUrl?: string
  hideHeader?: boolean // When true, omit the header (used when parent provides OrgNav)
}

export function FrontPageEditor({
  type,
  siteId,
  frontPage,
  organization,
  backUrl,
  previewUrl,
  hideHeader = false
}: FrontPageEditorProps) {
  const [content, setContent] = useState(frontPage?.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [versions, setVersions] = useState<FrontPageVersion[]>([])
  const [frontPageId, setFrontPageId] = useState(frontPage?.id || null)
  const [isPublished, setIsPublished] = useState(frontPage?.isPublished || false)
  const [justSaved, setJustSaved] = useState(false)
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [fileSkriptId, setFileSkriptId] = useState<string | null>(frontPage?.fileSkriptId || null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const contentRef = useRef(content)
  const { data: session } = useSession()
  const pageSlug = (session?.user as { pageSlug?: string })?.pageSlug
  const { isCustomDomain } = usePublicUrl(pageSlug)

  // On custom domains, the proxy prepends the pageSlug, so strip it from previewUrl
  const resolvedPreviewUrl = (() => {
    if (!previewUrl || !isCustomDomain || !pageSlug) return previewUrl
    const prefix = `/${pageSlug}`
    if (previewUrl.startsWith(prefix)) {
      return previewUrl.slice(prefix.length) || '/'
    }
    return previewUrl
  })()
  const alert = useAlertDialog()

  // File storage: the front page's dedicated fileSkriptId (created on demand).
  const effectiveSkriptId = fileSkriptId

  // Update ref when content changes — used by save/auto-save handlers so they
  // always send the latest content even if React state hasn't propagated.
  useEffect(() => {
    contentRef.current = content
  }, [content])

  const handleContentChange = useCallback((next: string) => {
    setContent(next)
    setHasUnsavedChanges(true)
  }, [])

  // Determine the API endpoint based on type
  const getApiEndpoint = useCallback(() => {
    if (type === 'user') {
      return siteId ? `/api/sites/${siteId}/frontpage` : '/api/frontpage/user'
    }
    return `/api/frontpage/organization/${organization?.id}`
  }, [type, siteId, organization?.id])

  // Load version history
  const loadVersions = useCallback(async () => {
    if (!frontPageId) return

    try {
      const response = await fetch(`/api/frontpage/${frontPageId}/versions`)
      if (response.ok) {
        const data = await response.json()
        setVersions(data.versions || [])
      } else {
        console.error('Failed to load versions')
      }
    } catch (error) {
      console.error('Error loading versions:', error)
    }
  }, [frontPageId])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const response = await fetch(getApiEndpoint(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentRef.current,
          isPublished
        })
      })

      if (response.ok) {
        const data = await response.json()
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
        setJustSaved(true)
        if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
        justSavedTimer.current = setTimeout(() => setJustSaved(false), 1500)

        // If this was the first save, update the frontPageId
        if (data.frontPage?.id && !frontPageId) {
          setFrontPageId(data.frontPage.id)
        }

        // Reload versions to show the new version
        if (data.versionCreated) {
          loadVersions()
        }
      } else {
        const data = await response.json()
        alert.showError(data.error || 'Failed to save front page')
      }
    } catch (error) {
      console.error('Error saving front page:', error)
      alert.showError('Failed to save front page')
    }
    setIsSaving(false)
  }, [getApiEndpoint, isPublished, frontPageId, loadVersions, alert])

  // Restore a previous version by hitting the FrontPage version-restore endpoint
  // and copying the restored content back into the editor.
  const handleRestoreVersion = async (versionId: string, versionContent: string) => {
    if (!frontPageId) return

    try {
      const response = await fetch(`/api/frontpage/${frontPageId}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        setContent(versionContent)
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
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

  // Save with Ctrl+S, Escape exits fullscreen.
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

  // Load version history on mount and when frontPageId changes
  useEffect(() => {
    if (frontPageId) {
      loadVersions()
    }
  }, [frontPageId, loadVersions])

  // For user/org frontpages, the file storage skript is created on demand.
  // POST /api/frontpage/[id]/ensure-file-storage creates a hidden skript and
  // wires its id back into the FrontPage row.
  const [isCreatingFileStorage, setIsCreatingFileStorage] = useState(false)
  const ensureFileStorage = async () => {
    if (!frontPageId) {
      alert.showError('Please save the front page first before adding files')
      return
    }

    setIsCreatingFileStorage(true)
    try {
      const response = await fetch(`/api/frontpage/${frontPageId}/ensure-file-storage`, {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        setFileSkriptId(data.fileSkriptId)
      } else {
        const data = await response.json()
        alert.showError(data.error || 'Failed to enable file storage')
      }
    } catch (error) {
      console.error('Error ensuring file storage:', error)
      alert.showError('Failed to enable file storage')
    } finally {
      setIsCreatingFileStorage(false)
    }
  }

  const title = type === 'user'
    ? 'Your front page'
    : organization?.name || 'Organization front page'

  const description = type === 'user'
    ? 'Customize your public landing page. This is what visitors see when they visit your profile.'
    : 'Customize your organization\'s public landing page. This is what visitors see when they visit your organization.'

  // Title row of the page card: same controls as PageEditor (status, then
  // Save with version history), via the shared page-card parts.
  const titleRowActions = (
    <div className="flex shrink-0 items-center gap-1 md:gap-2">
      <PublishToggle
        type="frontpage"
        itemId={frontPageId ?? ''}
        endpoint={getApiEndpoint()}
        isPublished={isPublished}
        onToggle={(published) => {
          setIsPublished(published)
          // First publish creates the front page server-side; reload to pick up its id.
          if (!frontPageId) window.location.reload()
        }}
        size="sm"
        publicUrl={resolvedPreviewUrl ?? null}
      />
      <SaveWithHistory
        onSave={() => void handleSave()}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        justSaved={justSaved}
        versions={versions}
        currentContent={content}
        onRestoreVersion={handleRestoreVersion}
        historyOpen={historyOpen}
        onHistoryOpenChange={setHistoryOpen}
      />
    </div>
  )

  const titleRow = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h2 className="min-w-0 flex-1 truncate px-3 text-lg md:text-xl font-semibold">Front page</h2>
      {titleRowActions}
    </div>
  )

  // Folder tab of the header card (neutral: the front page belongs to the
  // site itself) — counterpart of the page editor's blue "Skript" tab.
  const scopeLabel = (
    <>
      {type === 'organization' ? <Building2 className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
      {type === 'organization' ? 'Organization' : 'Site'}
    </>
  )

  // Header handed to EditorWithMedia as `headerContent` so it shares one
  // bordered card with the manage tab strip below — same grouping the page
  // editor uses for the skript header.
  const headerContent = (
    <div className="flex items-center gap-2 px-3 py-2">
      <Link href={backUrl} className="shrink-0">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4" />
        </Button>
      </Link>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xl font-semibold truncate leading-tight">{title}</span>
        <span className="text-xs text-muted-foreground truncate leading-snug">{description}</span>
      </div>
    </div>
  )

  // Orange folder tab of the page card (with the fullscreen toggle).
  const pageLabel = (
    <PageFolderLabel
      icon={<BookA className="w-3.5 h-3.5" />}
      // Qualified so it isn't confused with a skript's front page.
      label="Site front page"
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
    />
  )

  // File-storage CTA — only for user/org frontpages that haven't enabled
  // storage yet.
  const fileStorageCta = !effectiveSkriptId ? (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Files className="w-5 h-5" />
          Files & videos
        </CardTitle>
        <CardDescription>
          Enable file storage to upload images, videos, and other media to embed in your front page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={ensureFileStorage}
          disabled={isCreatingFileStorage || !frontPageId}
          variant="outline"
          size="sm"
        >
          {isCreatingFileStorage ? 'Enabling...' : 'Enable file storage'}
        </Button>
        {!frontPageId && (
          <p className="text-xs text-muted-foreground mt-2">
            Save the front page first to enable file storage.
          </p>
        )}
      </CardContent>
    </Card>
  ) : null

  return (
    <div
      className={
        isFullscreen
          // Same fullscreen layout the page editor uses: viewport-locked flex
          // column so the editor card can flex-1 into the remaining space and
          // its inner panes scroll independently. No `overflow-auto` here —
          // that would push the toolbar offscreen.
          ? FULLSCREEN_ROOT_CLASS
          // Same as the page editor: fill the dashboard's scroll area.
          : 'flex h-full flex-col gap-4'
      }
    >

      {/* Header hidden (org nav owns the page chrome): just the description;
          status and Save live in the page card's title row. */}
      {hideHeader && !isFullscreen && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      {/* Editor shell — owns the header + manage tabs in one card, and the
          "Front page" label + editor + footer in a second card. Always
          rendered: when effectiveSkriptId is missing (user/org frontpage
          without file storage yet) the shell hides its manage tabs, but the
          markdown editor and AI Edit (if a frontPageId exists) still work. */}
      <EditorWithMedia
        content={content}
        onChange={handleContentChange}
        onSave={handleSave}
        description={null}
        fillHeight
        skriptId={effectiveSkriptId || undefined}
        pageId={frontPageId || undefined}
        domain={pageSlug}
        headerContent={hideHeader ? undefined : headerContent}
        headerScope="neutral"
        headerLabel={hideHeader ? undefined : scopeLabel}
        manageLabel="Manage:"
        tabStorageKey="eduskript:frontpage-editor-tab"
        aiEdit={frontPageId ? {
          target: { mode: 'frontpage', frontPageId },
          targetTitle: title,
        } : undefined}
        onAIEditApplied={(newContent) => {
          // The frontpage AI flow doesn't save server-side — the hook hands
          // back the rewritten content and we drop it into the editor with
          // the dirty flag set, so the user can review and Ctrl+S.
          if (newContent !== undefined) {
            setContent(newContent)
            setHasUnsavedChanges(true)
          }
        }}
        isAdmin={(session?.user as { isAdmin?: boolean })?.isAdmin}
        fullscreen={isFullscreen}
        pageLabel={pageLabel}
        metadataSlot={titleRow}
        footerSlot={fileStorageCta ?? undefined}
      />

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
