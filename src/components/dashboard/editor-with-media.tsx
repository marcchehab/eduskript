'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { MarkdownEditor } from '@/components/dashboard/markdown-editor'
import { FileBrowser } from '@/components/dashboard/file-browser'
import { VideoBrowser } from '@/components/dashboard/video-browser'
import { ExcalidrawEditor } from '@/components/dashboard/excalidraw-editor'
import { AIEditChatModal } from '@/components/ai'
import type { AIEditTarget } from '@/hooks/use-ai-edit'
import { useIsFreeTeacher } from '@/hooks/use-billing'
import { QuestSpotlight } from '@/components/onboarding/quest-spotlight'
import { useQuestStep } from '@/lib/onboarding-quest/use-quest-step'
import { useRouter } from 'next/navigation'
import type { VideoInfo } from '@/lib/skript-files'
import { extractAndUploadPdfPages } from '@/lib/pdf-extract'
import type { PasteMenuOption } from '@/lib/paste-rules'
import {
  Files,
  Film,
  FileCode,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  // lucide-react 1.x removed all brand icons (incl. Youtube) over trademark
  // concerns; Video is the generic stand-in for the YouTube paste option.
  Video,
} from 'lucide-react'

export interface ExtraManageTab {
  id: string
  label: string
  icon: React.ReactNode
  content: React.ReactNode
  /** Where in the strip this tab sits relative to the built-in Files/Videos tabs.
   *  'start' renders before Files; 'end' (default) renders after Videos. */
  position?: 'start' | 'end'
  /** Tooltip shown on hover — helps new users tell the tabs apart. */
  title?: string
}

export interface AIEditConfig {
  /** Discriminated target — page (in a skript) or single front page */
  target: AIEditTarget
  /** Display title shown in the modal header */
  targetTitle: string
  /** Optional secondary label (e.g. skript title when editing a page within it) */
  targetSubtitle?: string
}

export interface EditorWithMediaProps {
  // Content
  content: string
  onChange: (next: string) => void
  onSave: () => void
  /** Replaces the default editor card description. Pass null to omit the header entirely. */
  description?: React.ReactNode

  // Identity for file/video API + Excalidraw + drag-drop
  /** Skript backing the file/video storage. For frontpages this is the skript itself
   *  or the hidden fileSkript. When omitted, the manage tabs (Files/Videos) and
   *  Excalidraw mount are hidden and file uploads are disabled — useful for the
   *  frontpage "no file storage yet" state where the user can still type and
   *  use AI edit but can't drag in media until they enable storage. */
  skriptId?: string
  /** pageSlug of the current user, used by the markdown pipeline for image resolution */
  domain?: string
  /** Page id used as the user-data persistence key. Frontpages can pass their frontPage.id here. */
  pageId?: string

  // Manage strip
  /** Skript/frontpage-level header (title, back button, publish toggle, etc.).
   *  Rendered above the manage tab strip inside one shared bordered card with
   *  a divider line between them — both belong to the skript, not the page
   *  being edited below. Omit to render the tab strip on its own (no card at
   *  all when there's also no skriptId). */
  headerContent?: React.ReactNode
  /** Border color of the header+tabs card. 'skript' (default) paints it blue;
   *  'neutral' keeps the plain border — used by the site/organization
   *  frontpage editor, whose header isn't skript-scoped. */
  headerScope?: 'skript' | 'neutral'
  /** Label shown before the tab buttons. Defaults to "Manage:". */
  manageLabel?: string
  /** Tabs to append after Files/Videos (e.g. Pages, Access for the page editor). */
  extraTabs?: ExtraManageTab[]
  /** localStorage key for persisting which tab is open. Use a value unique per parent
   *  (e.g. "eduskript:page-editor-tab", "eduskript:frontpage-editor-tab") so the two
   *  editors don't fight over the same persisted state. */
  tabStorageKey: string

  // AI Edit (omit to disable)
  aiEdit?: AIEditConfig
  /** Called after AI edits are applied. For page mode, the focused page's new content
   *  is passed; for frontpage mode, the rewritten frontpage content. Parent is
   *  responsible for actually persisting the new content via its own save flow. */
  onAIEditApplied?: (newContent?: string) => void | Promise<void>

  // Permissions
  /** Surfaces the admin-only "manual add video" form in the VideoBrowser. */
  isAdmin?: boolean

  // Layout
  /** When true, the editor card grows to fill its container (height: 100%) and the
   *  resize handle/description are hidden. Parent is responsible for wrapping in a
   *  fullscreen container. The manage section is also hidden in fullscreen. */
  fullscreen?: boolean
  /** Rendered between the manage section and the editor card. Page editor uses this
   *  for page metadata (title/slug/exam settings); frontpage editor leaves it empty. */
  metadataSlot?: React.ReactNode
  /** Label shown above the metadataSlot+editor card (e.g. "Page" for the page
   *  editor) — mirrors headerContent's relationship to the manage tab strip.
   *  Only rendered when metadataSlot is also provided, and hidden in fullscreen. */
  pageLabel?: React.ReactNode
  /** Rendered after the editor card, inside the same bordered card as
   *  metadataSlot (e.g. version history) — it's part of the page too, not a
   *  separate scope. Hidden in fullscreen. */
  footerSlot?: React.ReactNode
}

const DEFAULT_EDITOR_HEIGHT = 500
const EDITOR_HEIGHT_STORAGE_KEY = 'eduskript:editor-height'

/** Derive an image file extension from a pasted blob.
 *  Prefers the original filename's extension (preserved when copying off a
 *  webpage); falls back to the MIME type, then 'png' as a last resort. */
function deriveImageExtension(file: File): string {
  const fromName = file.name?.match(/\.([^/.]+)$/)?.[1]
  if (fromName) return fromName.toLowerCase()
  const fromMime = file.type?.split('/')[1]
  return (fromMime || 'png').toLowerCase()
}

export function EditorWithMedia({
  content,
  onChange,
  onSave,
  description,
  skriptId,
  domain,
  pageId,
  headerContent,
  headerScope = 'skript',
  manageLabel = 'Manage:',
  extraTabs,
  tabStorageKey,
  aiEdit,
  onAIEditApplied,
  isAdmin,
  fullscreen = false,
  metadataSlot,
  pageLabel,
  footerSlot,
}: EditorWithMediaProps) {
  const alert = useAlertDialog()
  const isFreePlan = useIsFreeTeacher()
  const router = useRouter()

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
  const [videoList, setVideoList] = useState<VideoInfo[]>([])
  const [fileListLoading, setFileListLoading] = useState(false)

  const [activeTab, setActiveTab] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(tabStorageKey) || null
  })
  const { completeStep } = useQuestStep()

  const [insertionMenuFile, setInsertionMenuFile] = useState<{
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    rawFile?: File
    position?: number
    x?: number
    y?: number
  } | null>(null)

  // Paste-helper menu — shown when classifyPaste returns a 'menu' intent
  // (currently: image URL paste). Position is the document offset; x/y are
  // viewport screen coords for popup placement.
  const [pasteMenu, setPasteMenu] = useState<{
    options: PasteMenuOption[]
    position: number
    x: number
    y: number
  } | null>(null)

  // Pasted image awaiting filename + confirmation. The user types a name in
  // the dialog and clicks Save; only then does the upload run. `name` is the
  // basename without extension (UX matches the Excalidraw editor).
  const [pasteImagePending, setPasteImagePending] = useState<{
    file: File
    position: number
    ext: string
    name: string
  } | null>(null)

  const [pdfExtracting, setPdfExtracting] = useState<string | null>(null)

  const [excalidrawEditorOpen, setExcalidrawEditorOpen] = useState(false)
  const [excalidrawEditFile, setExcalidrawEditFile] = useState<{
    id: string
    name: string
    excalidrawData?: {
      elements: readonly unknown[]
      appState?: unknown
      files?: Record<string, unknown>
    } | null
    skriptId?: string
  } | null>(null)

  const [aiEditModalOpen, setAiEditModalOpen] = useState(false)

  const [editorHeight, setEditorHeight] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_EDITOR_HEIGHT
    const saved = localStorage.getItem(EDITOR_HEIGHT_STORAGE_KEY)
    return saved ? parseInt(saved, 10) : DEFAULT_EDITOR_HEIGHT
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
      localStorage.setItem(EDITOR_HEIGHT_STORAGE_KEY, String(finalHeight))
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [editorHeight])

  const handleTabClick = useCallback((tab: string) => {
    setActiveTab(prev => {
      const next = prev === tab ? null : tab
      if (next) {
        localStorage.setItem(tabStorageKey, next)
      } else {
        localStorage.removeItem(tabStorageKey)
      }
      return next
    })
  }, [tabStorageKey])

  // Fetch files + videos. No-op when skriptId is missing (no file storage yet).
  const loadedOnceRef = useRef(false)
  const refreshFileList = useCallback(async () => {
    if (!skriptId) {
      setFileList([])
      setVideoList([])
      return
    }
    // Only show the skeleton on the first load. Later refreshes (upload, delete,
    // and the video browser's 5s status poll while Mux is processing) keep the
    // current list on screen instead of flashing it away.
    if (!loadedOnceRef.current) setFileListLoading(true)
    try {
      const response = await fetch(`/api/upload?skriptId=${skriptId}`)
      if (response.ok) {
        const data = await response.json()
        setFileList(data.files || [])
        setVideoList(data.videos || [])
      }
    } catch (error) {
      console.error('Error fetching file list:', error)
    } finally {
      loadedOnceRef.current = true
      setFileListLoading(false)
    }
  }, [skriptId])

  useEffect(() => {
    refreshFileList()
  }, [refreshFileList])

  // Link text for a file link: the basename without extension. The href is
  // the bare filename — markdown-components' AnchorComponent resolves it to the
  // current file URL at render time, so the link survives a re-upload with the
  // same name (a pasted S3 URL would not).
  const linkLabel = (name: string) => name.replace(/\.[^.]+$/, '')

  // Insert file content at the current cursor position (or append to end).
  // Branches on extension and insertion type. Note that .mp4/.mov go through
  // the Mux pipeline (`![](filename)`) — the markdown renderer resolves them
  // via remarkMuxVideo. Raw <video> tags are not used.
  const handleFileInsert = useCallback((file: {
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    position?: number
  }, insertionType: 'embed' | 'link' | 'sql-editor' | 'pdf-page' = 'embed') => {
    if (file.isDirectory) return

    const extension = file.name.split('.').pop()?.toLowerCase()
    let insertText = ''

    if (extension === 'pdf' && insertionType === 'pdf-page') {
      insertText = `<pdf src="${file.name}" height="1267"></pdf>`
    } else if (['sqlite', 'db'].includes(extension || '')) {
      if (insertionType === 'sql-editor') {
        insertText = `\`\`\`sql editor db="${file.name}"\n-- Show all tables in the database\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\n\`\`\``
      } else {
        insertText = `[${linkLabel(file.name)}](${file.name})`
      }
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      if (insertionType === 'embed') {
        // Empty alt by default — the markdown pipeline turns alt into a
        // figcaption shown beneath the image, and the basename is rarely
        // what the author wants to display. Authors add a caption manually
        // when they want one.
        insertText = `![](${file.name})`
      } else {
        insertText = `[${linkLabel(file.name)}](${file.name})`
      }
    } else if (extension === 'excalidraw') {
      insertText = `![](${file.name})`
    } else if (['mp4', 'mov'].includes(extension || '')) {
      // Mux-hosted video reference (resolved at render time via remarkMuxVideo)
      insertText = `![](${file.name})`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Bare filename; markdown-components' AudioComponent resolves it to the
      // current file URL at render time.
      insertText = `<audio controls src="${file.name}"></audio>`
    } else {
      insertText = `[${linkLabel(file.name)}](${file.name})`
    }

    if (file.position !== undefined) {
      const pos = file.position
      onChange(content.slice(0, pos) + insertText + content.slice(pos))
    } else {
      onChange(content + '\n\n' + insertText)
    }
  }, [content, onChange])

  const handleFileRenamed = useCallback((oldFilename: string, newFilename: string) => {
    const escaped = oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const updated = content
      .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${escaped}\\)`, 'g'), `![$1](${newFilename})`)
      .replace(new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, 'g'), `[$1](${newFilename})`)
      .replace(new RegExp(`<source src="${escaped}"`, 'g'), `<source src="${newFilename}"`)

    if (updated !== content) onChange(updated)
  }, [content, onChange])

  const handleExcalidrawEdit = useCallback(async (file: { id: string; name: string; url?: string; skriptId?: string }) => {
    try {
      if (!file.id) {
        setExcalidrawEditFile({
          id: '',
          name: file.name,
          excalidrawData: null,
          skriptId: file.skriptId || skriptId,
        })
        setExcalidrawEditorOpen(true)
        return
      }

      const baseUrl = file.url || `/api/files/${file.id}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const fileUrl = `${baseUrl}${separator}v=${Date.now()}`
      const response = await fetch(fileUrl)

      if (!response.ok) throw new Error('Failed to load drawing')
      const text = await response.text()
      let excalidrawData
      try {
        excalidrawData = JSON.parse(text)
      } catch {
        // Obsidian Excalidraw format: ```json { ... } ```
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        if (jsonMatch) excalidrawData = JSON.parse(jsonMatch[1])
        else throw new Error('Could not parse Excalidraw data')
      }

      setExcalidrawEditFile({ ...file, excalidrawData })
      setExcalidrawEditorOpen(true)
    } catch (error) {
      console.error('Error loading Excalidraw file:', error)
      alert.showError('Failed to load drawing for editing')
    }
  }, [skriptId, alert])

  const handleExcalidrawSave = useCallback(async (
    name: string,
    excalidrawData: string,
    lightSvg: string,
    darkSvg: string,
    originalName: string | undefined,
  ) => {
    try {
      const response = await fetch('/api/excalidraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, excalidrawData, lightSvg, darkSvg, skriptId, originalName }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save drawing')
      }
      setExcalidrawEditorOpen(false)
      setExcalidrawEditFile(null)
      await refreshFileList()
    } catch (error) {
      console.error('[handleExcalidrawSave] Exception:', error)
      throw error
    }
  }, [skriptId, refreshFileList])

  const showInsertionMenu = useCallback((file: {
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    rawFile?: File
  }, position: number, screenX: number, screenY: number) => {
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
  }, [handleFileInsert, refreshFileList])

  // Paste-helper menu handler — fired by codemirror-editor when classifyPaste
  // returns a multi-option intent (e.g. image URL: embed vs. link).
  const handlePasteMenu = useCallback((
    options: PasteMenuOption[],
    position: number,
    screenX: number,
    screenY: number,
  ) => {
    setPasteMenu({ options, position, x: screenX, y: screenY })
  }, [])

  // Insert pasted-menu choice at the original caret position. Mirrors
  // handleFileInsert's slice-based string update so the parent's content
  // state stays the source of truth.
  const handlePasteMenuPick = useCallback((option: PasteMenuOption, position: number) => {
    onChange(content.slice(0, position) + option.insert + content.slice(position))
    setPasteMenu(null)
  }, [content, onChange])

  // Image-blob paste — open a small "Save pasted image" dialog so the user
  // names the file before upload. Browsers hand pasted screenshots the
  // generic name "image.png", so without this prompt every screenshot would
  // collide on the second paste. The dialog also doubles as a confirmation
  // step (explicit Save click) before any upload happens.
  const handlePasteImageUpload = useCallback((file: File, position: number) => {
    if (!skriptId) {
      alert.showError('Paste an image into a skript editor to upload it. There is no file storage attached here.')
      return
    }
    const MAX_FILE_SIZE = 500 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      alert.showError(`Image is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 500MB.`)
      return
    }
    const ext = deriveImageExtension(file)
    // Browsers usually hand clipboard images a generic name like "image.png".
    // Treat those as "no name" so the user types one; preserve real names
    // (e.g. "mountain" from a right-click-copy on a webpage).
    const baseName = (file.name || '').replace(/\.[^/.]+$/, '')
    const generic = !baseName || /^(image|paste|screenshot|untitled|unknown)$/i.test(baseName)
    setPasteImagePending({ file, position, ext, name: generic ? '' : baseName })
  }, [skriptId, alert])

  // Confirm-and-upload from the dialog. Builds a renamed File so the
  // existing /api/upload endpoint stores it under the user's chosen name.
  const performPasteImageUpload = useCallback(async () => {
    if (!pasteImagePending || !skriptId) return
    const { file, position, ext, name } = pasteImagePending
    const trimmed = name.trim()
    if (!trimmed) return
    const finalName = `${trimmed}.${ext}`

    // Defensive collision check; the Save button is disabled when we already
    // know there's a clash, but fileList may have been refreshed in the
    // background between render and click.
    if (fileList.some(f => f.name.toLowerCase() === finalName.toLowerCase())) {
      alert.showError(`A file named "${finalName}" already exists. Please choose a different name.`)
      return
    }

    try {
      const renamedFile = new File([file], finalName, { type: file.type })
      const formData = new FormData()
      formData.append('file', renamedFile)
      formData.append('uploadType', 'skript')
      formData.append('skriptId', skriptId)
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(err.error || 'Upload failed')
      }
      const uploaded = await response.json()
      handleFileInsert({ ...uploaded, position }, 'embed')
      refreshFileList()
      setPasteImagePending(null)
    } catch (error) {
      console.error('Paste upload failed:', error)
      alert.showError(error instanceof Error ? error.message : 'Failed to upload pasted image')
    }
  }, [pasteImagePending, skriptId, alert, fileList, handleFileInsert, refreshFileList])

  // Tab strip — extras with `position: 'start'` (e.g. Pages in the page editor)
  // come first, then the built-in Files/Videos, then end-positioned extras.
  const builtInTabs: ExtraManageTab[] = [
    { id: 'files', label: 'Files', icon: <Files className="w-3.5 h-3.5" />, content: null, title: 'Upload and insert images, documents, and other files into this content' },
    { id: 'videos', label: 'Videos', icon: <Film className="w-3.5 h-3.5" />, content: null, title: 'Upload and insert videos into this content' },
  ]
  const startExtras = (extraTabs ?? []).filter(t => t.position === 'start')
  const endExtras = (extraTabs ?? []).filter(t => t.position !== 'start')
  const allTabs = [...startExtras, ...builtInTabs, ...endExtras]

  // The page-scope (orange) card wraps metadata + editor + footer. The page
  // editor turns it on via metadataSlot; the frontpage editor has no metadata
  // row, so its pageLabel alone is enough.
  const hasPageCard = Boolean(metadataSlot || pageLabel)

  return (
    <>
      {/* Header + manage tab strip share one card — both belong to the
          skript/frontpage, not the individual page below, so a single
          rounded border encapsulates them with a divider line in between.
          The tab strip is hidden in fullscreen, and hidden entirely when
          there's no skriptId (no file storage to manage) — the editor below
          still renders either way, so the user can type and use AI edit. */}
      {!fullscreen && (headerContent || skriptId) && (
      <section className={`rounded-lg overflow-hidden divide-y divide-border ${
        headerScope === 'neutral' ? 'border' : 'border border-blue-400/70 dark:border-blue-500/60'
      }`}>
        {headerContent}
        {skriptId && (
        <div>
          <div className="flex items-center">
            <span className="px-3 text-xs text-muted-foreground whitespace-nowrap">{manageLabel}</span>
            {allTabs.map((tab) => {
              const button = (
                <button
                  key={tab.id}
                  onClick={() => {
                    handleTabClick(tab.id)
                    if (tab.id === 'pages') completeStep('view_pages')
                  }}
                  title={tab.title}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab.id === 'pages'
                      // Orange, matching the page-scope card below — Pages is
                      // the tab that jumps between pages, so the tint signals
                      // that connection. Active indicator stays blue (border-primary)
                      // like every other tab — it's still part of the skript-scope strip.
                      ? activeTab === tab.id
                        ? 'bg-background text-orange-600 dark:text-orange-400 shadow-xs border-b-2 border-primary'
                        : 'text-orange-600/80 dark:text-orange-400/80 hover:text-orange-600 dark:hover:text-orange-400 bg-muted/50'
                      : activeTab === tab.id
                        ? 'bg-background text-foreground shadow-xs border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground bg-muted/50'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              )
              return tab.id === 'pages' ? (
                <QuestSpotlight key={tab.id} step="view_pages" label="Try this!">
                  {button}
                </QuestSpotlight>
              ) : (
                button
              )
            })}
          </div>

          {/* Tab content — built-in panels rendered here, extras render their own JSX */}
          {activeTab === 'files' && (
            <div className="border-t">
              <FileBrowser
                skriptId={skriptId}
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

          {activeTab === 'videos' && (
            <div className="border-t">
              <VideoBrowser
                videos={videoList}
                loading={fileListLoading}
                isAdmin={isAdmin}
                skriptId={skriptId}
                onVideoAdded={refreshFileList}
                onUploadComplete={refreshFileList}
              />
            </div>
          )}

          {extraTabs?.map((tab) => activeTab === tab.id && (
            <div key={tab.id} className="border-t">
              {tab.content}
            </div>
          ))}
        </div>
        )}
      </section>
      )}

      {/* Page label + metadata + editor share one bordered card — same
          "one border per scope" idea as the skript header+tabs above — so a
          single border visually groups everything about THIS page. Border
          drops away in fullscreen, same as the Card itself always did;
          metadataSlot is still always rendered — the parent decides what's
          visible in fullscreen, since some controls (e.g. the fullscreen
          toggle itself) need to stay reachable. */}
      {!fullscreen && pageLabel}
      <div className={
        fullscreen
          ? 'flex-1 min-h-0 flex flex-col'
          : hasPageCard
            ? 'border border-orange-400/70 dark:border-orange-500/60 rounded-lg overflow-hidden'
            : ''
      }>
        {metadataSlot && (
          <div className={fullscreen ? '' : 'p-3'}>
            {metadataSlot}
          </div>
        )}

        {/* Editor card. In fullscreen, `min-h-0` is the magic bit: without it
            the flex child defaults to min-height:auto and refuses to shrink
            below its content, which breaks the inner panes' ability to scroll
            within their own bounds. */}
        <Card className={
          fullscreen
            ? 'border-0 shadow-none flex-1 min-h-0 flex flex-col'
            // Inside the page card the editor's own rounded border is enough:
            // no card background, and p-3 matches the footer (version history)
            // width.
            : hasPageCard ? 'border-0 rounded-none shadow-none bg-transparent' : ''
        }>
        {!fullscreen && (description !== null) && (
          <CardHeader className="pb-2">
            <CardDescription>
              {description ?? 'Drag files or videos from the drawers to insert them. Ctrl+S to save.'}
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className={fullscreen ? 'flex-1 overflow-hidden' : hasPageCard ? 'p-3' : ''}>
          <div
            style={{ height: fullscreen ? '100%' : `${editorHeight}px` }}
            className={fullscreen ? '' : 'overflow-hidden'}
          >
            <MarkdownEditor
              content={content}
              onChange={onChange}
              onSave={onSave}
              onFileInsert={handleFileInsert}
              onFileDrop={(file, position, screenX, screenY) =>
                showInsertionMenu(file, position, screenX, screenY)
              }
              onPasteMenu={handlePasteMenu}
              onPasteImageUpload={handlePasteImageUpload}
              skriptId={skriptId}
              pageId={pageId}
              domain={domain}
              fileList={fileList}
              videoList={videoList}
              fileListLoading={fileListLoading}
              onFileUpload={refreshFileList}
              onAIEdit={aiEdit ? () => {
                if (isFreePlan) router.push('/dashboard/billing')
                else setAiEditModalOpen(true)
              } : undefined}
              aiEditLocked={Boolean(aiEdit) && isFreePlan}
              onExcalidrawEdit={(filename, fileId) => handleExcalidrawEdit({ id: fileId, name: filename })}
            />
          </div>
          {!fullscreen && (
            <div
              onMouseDown={handleEditorResizeStart}
              className="h-2 cursor-row-resize flex items-center justify-center hover:bg-muted/50 transition-colors -mb-4 mt-1"
            >
              <div className="w-12 h-1 rounded-full bg-muted-foreground/20" />
            </div>
          )}
        </CardContent>
      </Card>
      {!fullscreen && footerSlot && (
        <div className="p-3 border-t border-border">
          {footerSlot}
        </div>
      )}
      </div>

      {/* Excalidraw editor modal — requires skriptId (storage destination). */}
      {excalidrawEditFile && skriptId && (
        <ExcalidrawEditor
          open={excalidrawEditorOpen}
          onClose={() => {
            setExcalidrawEditorOpen(false)
            setExcalidrawEditFile(null)
          }}
          onSave={handleExcalidrawSave}
          skriptId={skriptId}
          initialData={{
            name: excalidrawEditFile.name.replace('.excalidraw', ''),
            elements: excalidrawEditFile.excalidrawData?.elements || [],
            appState: excalidrawEditFile.excalidrawData?.appState,
            files: excalidrawEditFile.excalidrawData?.files,
          }}
        />
      )}

      {/* Insertion menu popup — multi-option file types (DB, image, PDF). Only
          shows when there's a skriptId, since the menu's actions all upload to
          a skript's file storage. */}
      {insertionMenuFile && skriptId && (() => {
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

                      if (file.rawFile) {
                        const formData = new FormData()
                        formData.append('file', file.rawFile)
                        formData.append('uploadType', 'skript')
                        formData.append('skriptId', skriptId)
                        try {
                          const response = await fetch('/api/upload', { method: 'POST', body: formData })
                          if (!response.ok) {
                            const err = await response.json().catch(() => ({ error: 'Upload failed' }))
                            throw new Error(err.error || 'Upload failed')
                          }
                          const uploaded = await response.json()
                          if (uploaded.existed) {
                            alert.showInfo('A file with this name already existed and was embedded. Rename or delete the existing file to re-upload.', 'Existing file used')
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

                      const pdfUrl = file.rawFile
                        ? URL.createObjectURL(file.rawFile)
                        : (file.url || `/api/files/${file.id}`)
                      setPdfExtracting('Loading PDF…')

                      try {
                        const filenames = await extractAndUploadPdfPages(
                          pdfUrl,
                          file.name,
                          skriptId,
                          (current, total) => setPdfExtracting(`Extracting page ${current}/${total}…`)
                        )

                        const imgTags = filenames.map((name, i) => `![${i + 1}](${name})`).join('\n')
                        const insertText = `<fullwidth class="invert-dark">\n\n${imgTags}\n\n</fullwidth>`

                        if (file.position !== undefined) {
                          const pos = file.position
                          onChange(content.slice(0, pos) + insertText + content.slice(pos))
                        } else {
                          onChange(content + '\n\n' + insertText)
                        }
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
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                    onClick={async () => {
                      const file = insertionMenuFile
                      setInsertionMenuFile(null)

                      if (file.rawFile) {
                        const formData = new FormData()
                        formData.append('file', file.rawFile)
                        formData.append('uploadType', 'skript')
                        formData.append('skriptId', skriptId)
                        try {
                          const response = await fetch('/api/upload', { method: 'POST', body: formData })
                          if (!response.ok) {
                            const err = await response.json().catch(() => ({ error: 'Upload failed' }))
                            throw new Error(err.error || 'Upload failed')
                          }
                          const uploaded = await response.json()
                          if (uploaded.existed) {
                            alert.showInfo('A file with this name already existed and was linked. Rename or delete the existing file to re-upload.', 'Existing file used')
                          }
                          handleFileInsert({ ...file, id: uploaded.id, url: uploaded.url }, 'link')
                        } catch (error) {
                          console.error('PDF upload failed:', error)
                          alert.showError(error instanceof Error ? error.message : 'Failed to upload PDF')
                          return
                        }
                      } else {
                        handleFileInsert(file, 'link')
                      }
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

      {/* Paste-image rename dialog — pasted screenshots are uploaded under the
          user's chosen filename. Mirrors the Excalidraw editor's name+save UX:
          the basename is typed by hand and the extension is appended. The
          live collision check against fileList disables Save when the name
          would clash, so we never round-trip just to discover a conflict. */}
      <Dialog
        open={!!pasteImagePending}
        onOpenChange={(o) => { if (!o) setPasteImagePending(null) }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Save pasted image</DialogTitle>
            <DialogDescription>
              Pick a filename for the pasted image. It will be uploaded to this skript&apos;s files and embedded at the cursor.
            </DialogDescription>
          </DialogHeader>
          {pasteImagePending && (() => {
            const trimmed = pasteImagePending.name.trim()
            const fullName = trimmed ? `${trimmed}.${pasteImagePending.ext}` : null
            const collides = !!fullName && fileList.some(f => f.name.toLowerCase() === fullName.toLowerCase())
            const canSave = !!fullName && !collides
            return (
              <>
                <div className="space-y-2">
                  <Label htmlFor="paste-image-name">Filename</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="paste-image-name"
                      value={pasteImagePending.name}
                      onChange={(e) =>
                        setPasteImagePending(p => p ? { ...p, name: e.target.value } : p)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSave) {
                          e.preventDefault()
                          performPasteImageUpload()
                        }
                      }}
                      placeholder="my-image"
                      autoFocus
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">.{pasteImagePending.ext}</span>
                  </div>
                  {collides ? (
                    <p className="text-xs text-destructive">
                      A file named &quot;{fullName}&quot; already exists. Choose a different name.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Will be saved as: {fullName || `your-name.${pasteImagePending.ext}`}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPasteImagePending(null)}>Cancel</Button>
                  <Button onClick={performPasteImageUpload} disabled={!canSave}>
                    Save and embed
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Paste-helper menu — shown when classifyPaste returns a 'menu' intent
          (currently image URL paste). Mirrors the drag-drop popup shape. */}
      {pasteMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPasteMenu(null)}
          />
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]"
            style={{ left: `${pasteMenu.x}px`, top: `${pasteMenu.y}px` }}
          >
            {pasteMenu.options.map((option, idx) => {
              const Icon =
                option.icon === 'image' ? ImageIcon
                : option.icon === 'youtube' ? Video
                : Link2
              return (
                <button
                  key={idx}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                  onClick={() => handlePasteMenuPick(option, pasteMenu.position)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {option.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* PDF page extraction progress overlay */}
      {pdfExtracting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-xs">
          <div className="flex items-center gap-3 bg-popover border border-border rounded-lg px-5 py-3 shadow-lg">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{pdfExtracting}</span>
          </div>
        </div>
      )}

      {/* AI Edit modal */}
      {aiEdit && (
        <AIEditChatModal
          open={aiEditModalOpen}
          onOpenChange={setAiEditModalOpen}
          target={aiEdit.target}
          targetTitle={aiEdit.targetTitle}
          targetSubtitle={aiEdit.targetSubtitle}
          currentContent={content}
          onEditsApplied={onAIEditApplied}
        />
      )}

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </>
  )
}
