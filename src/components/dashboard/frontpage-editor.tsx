'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { EditorWithMedia } from '@/components/dashboard/editor-with-media'
import { ArrowLeft, Save, History, Eye, Files, BookA, Maximize2, Minimize2 } from 'lucide-react'
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
  // For user frontpage: pass userId and no skript
  // For skript frontpage: pass skript details
  // For organization frontpage: pass organization details
  type: 'user' | 'skript' | 'organization'
  frontPage?: {
    id: string
    content: string
    isPublished: boolean
    fileSkriptId?: string | null
  } | null
  skript?: {
    id: string
    slug: string
    title: string
    collectionSlug?: string
  }
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
  frontPage,
  skript,
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

  // Effective skript ID for file storage:
  // - Skript FrontPages use their skript's own files
  // - User/Org FrontPages use their dedicated fileSkriptId (created on demand)
  const effectiveSkriptId = type === 'skript' ? skript?.id : fileSkriptId

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
      return '/api/frontpage/user'
    } else if (type === 'organization') {
      return `/api/frontpage/organization/${organization?.id}`
    } else {
      return `/api/frontpage/skript/${skript?.id}`
    }
  }, [type, skript?.id, organization?.id])

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

  // Toggle publish state and save in one shot. Reverts the optimistic update
  // if the server rejects it.
  const handlePublishToggle = async () => {
    const newPublishedState = !isPublished
    setIsPublished(newPublishedState)
    setHasUnsavedChanges(true)

    try {
      const response = await fetch(getApiEndpoint(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentRef.current,
          isPublished: newPublishedState
        })
      })

      if (response.ok) {
        const data = await response.json()
        setLastSaved(new Date())
        setHasUnsavedChanges(false)

        if (data.frontPage?.id && !frontPageId) {
          setFrontPageId(data.frontPage.id)
        }
      } else {
        setIsPublished(!newPublishedState)
        const data = await response.json()
        alert.showError(data.error || 'Failed to update publish state')
      }
    } catch (error) {
      setIsPublished(!newPublishedState)
      console.error('Error updating publish state:', error)
      alert.showError('Failed to update publish state')
    }
  }

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
    : type === 'organization'
    ? organization?.name || 'Organization front page'
    : skript?.title || 'Skript front page'

  const description = type === 'user'
    ? 'Customize your public landing page. This is what visitors see when they visit your profile.'
    : type === 'organization'
    ? 'Customize your organization\'s public landing page. This is what visitors see when they visit your organization.'
    : 'Customize the introduction page for this skript. Visitors will see this before the list of pages.'

  // Action cluster shared between the full header and the hideHeader toolbar.
  const actionCluster = (
    <div className="flex gap-2 items-center">
      <Button
        variant={isPublished ? 'default' : 'outline'}
        size="sm"
        onClick={handlePublishToggle}
        title={isPublished ? 'Published - click to unpublish' : 'Draft - click to publish'}
      >
        {isPublished ? 'Published' : 'Draft'}
      </Button>

      {resolvedPreviewUrl && (
        <Link
          href={resolvedPreviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
        >
          <Button variant="ghost" size="sm" title="Preview front page">
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
  )

  return (
    <div
      className={
        isFullscreen
          // Same fullscreen layout the page editor uses: viewport-locked flex
          // column so the editor card can flex-1 into the remaining space and
          // its inner panes scroll independently. No `overflow-auto` here —
          // that would push the toolbar offscreen.
          ? 'fixed inset-0 z-50 bg-background p-6 flex flex-col gap-4'
          : 'space-y-6'
      }
    >
      {/* Front page header — mirrors the page editor's topbar style: bordered
          section with back button + label + title on the left, action cluster on
          the right. Hidden when the parent (e.g. OrgNav) provides its own nav. */}
      {!hideHeader && (
        <section className="border rounded-lg">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex items-center justify-between w-[7.5rem] flex-shrink-0">
              <Link href={backUrl}>
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-1.5">
                <BookA className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground">Front page:</span>
              </div>
            </div>
            <span className="text-3xl font-semibold truncate">{title}</span>
            <div className="ml-auto flex-shrink-0">{actionCluster}</div>
          </div>
        </section>
      )}

      {/* Toolbar when header is hidden — keeps publish/preview/save reachable
          while letting the parent (org nav) own the page chrome. */}
      {hideHeader && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          {actionCluster}
        </div>
      )}

      {/* Editor shell — always rendered. When effectiveSkriptId is missing
          (user/org frontpage without file storage yet), the shell hides its
          manage tabs but the markdown editor and AI Edit (if a frontPageId
          exists) still work. */}
      <EditorWithMedia
        content={content}
        onChange={handleContentChange}
        onSave={handleSave}
        description={
          effectiveSkriptId
            ? 'Drag files or videos from the drawers to insert them. Ctrl+S to save.'
            : frontPageId
              ? 'Enable file storage below to add images and videos. Ctrl+S to save.'
              : 'Save first to enable AI Edit and file storage. Ctrl+S to save.'
        }
        skriptId={effectiveSkriptId || undefined}
        pageId={frontPageId || undefined}
        domain={pageSlug}
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
      />

      {/* File storage CTA — only for user/org frontpages that haven't enabled
          storage yet. Skript frontpages always have storage (their own skript).
          Hidden in fullscreen so the editor takes the whole viewport. */}
      {!effectiveSkriptId && type !== 'skript' && !isFullscreen && (
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
      )}

      {/* Version history — only show if we have any. Uses the FrontPageVersion
          API (different from the page editor's PageVersion API). Hidden in
          fullscreen. */}
      {frontPageId && versions.length > 0 && !isFullscreen && (
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
          <div className="space-y-2">
            {versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div>
                  <div className="font-medium">Version {version.version}</div>
                  <div className="text-xs text-muted-foreground">
                    {version.author?.name || version.author?.email} • {new Date(version.createdAt).toLocaleString()}
                    {version.changeLog && ` • ${version.changeLog}`}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestoreVersion(version.id, version.content)}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </CollapsibleDrawer>
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
