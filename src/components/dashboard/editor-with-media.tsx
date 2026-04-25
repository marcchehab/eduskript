'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { MarkdownEditor } from '@/components/dashboard/markdown-editor'
import { FileBrowser } from '@/components/dashboard/file-browser'
import { VideoBrowser } from '@/components/dashboard/video-browser'
import { ExcalidrawEditor } from '@/components/dashboard/excalidraw-editor'
import { AIEditModal } from '@/components/ai'
import type { AIEditTarget } from '@/hooks/use-ai-edit'
import type { VideoInfo } from '@/lib/skript-files'
import { extractAndUploadPdfPages } from '@/lib/pdf-extract'
import {
  Files,
  Film,
  FileCode,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Wand2,
} from 'lucide-react'

export interface ExtraManageTab {
  id: string
  label: string
  icon: React.ReactNode
  content: React.ReactNode
  /** Where in the strip this tab sits relative to the built-in Files/Videos tabs.
   *  'start' renders before Files; 'end' (default) renders after Videos. */
  position?: 'start' | 'end'
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
}

const DEFAULT_EDITOR_HEIGHT = 500
const EDITOR_HEIGHT_STORAGE_KEY = 'eduskript:editor-height'

export function EditorWithMedia({
  content,
  onChange,
  onSave,
  description,
  skriptId,
  domain,
  pageId,
  manageLabel = 'Manage:',
  extraTabs,
  tabStorageKey,
  aiEdit,
  onAIEditApplied,
  isAdmin,
  fullscreen = false,
  metadataSlot,
}: EditorWithMediaProps) {
  const alert = useAlertDialog()

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
  const refreshFileList = useCallback(async () => {
    if (!skriptId) {
      setFileList([])
      setVideoList([])
      return
    }
    setFileListLoading(true)
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
      setFileListLoading(false)
    }
  }, [skriptId])

  useEffect(() => {
    refreshFileList()
  }, [refreshFileList])

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
        insertText = `[${file.name}](${file.url || file.name})`
      }
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      if (insertionType === 'embed') {
        const altText = file.name.replace(/\.[^/.]+$/, '')
        insertText = `![${altText}](${file.name})`
      } else {
        insertText = `[${file.name}](${file.url || file.name})`
      }
    } else if (extension === 'excalidraw') {
      insertText = `![](${file.name})`
    } else if (['mp4', 'mov'].includes(extension || '')) {
      // Mux-hosted video reference (resolved at render time via remarkMuxVideo)
      insertText = `![](${file.name})`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      insertText = `<audio controls>\n  <source src="${file.url || file.name}" type="audio/${extension}">\n  Your browser does not support the audio tag.\n</audio>`
    } else {
      insertText = `[${file.name}](${file.url || file.name})`
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

  // Tab strip — extras with `position: 'start'` (e.g. Pages in the page editor)
  // come first, then the built-in Files/Videos, then end-positioned extras.
  const builtInTabs: ExtraManageTab[] = [
    { id: 'files', label: 'Files', icon: <Files className="w-3.5 h-3.5" />, content: null },
    { id: 'videos', label: 'Videos', icon: <Film className="w-3.5 h-3.5" />, content: null },
  ]
  const startExtras = (extraTabs ?? []).filter(t => t.position === 'start')
  const endExtras = (extraTabs ?? []).filter(t => t.position !== 'start')
  const allTabs = [...startExtras, ...builtInTabs, ...endExtras]

  return (
    <>
      {/* Manage tab strip — hidden in fullscreen, and also hidden entirely when
          there's no skriptId (no file storage to manage). The editor below still
          renders, so the user can type and use AI edit. */}
      {!fullscreen && skriptId && (
      <section className="border rounded-lg">
        <div className="flex items-center">
          <span className="px-3 text-xs text-muted-foreground whitespace-nowrap">{manageLabel}</span>
          {allTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground bg-muted/50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
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
      </section>
      )}

      {/* Parent-supplied metadata (page title/slug/exam settings, etc.). Always
          rendered — the parent decides what's visible in fullscreen, since some
          controls (e.g. the fullscreen toggle itself) need to stay reachable. */}
      {metadataSlot}

      {/* Editor card. In fullscreen, `min-h-0` is the magic bit: without it
          the flex child defaults to min-height:auto and refuses to shrink
          below its content, which breaks the inner panes' ability to scroll
          within their own bounds. */}
      <Card className={fullscreen ? 'border-0 shadow-none flex-1 min-h-0 flex flex-col' : ''}>
        {!fullscreen && (description !== null) && (
          <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
            <CardDescription className="flex-1">
              {description ?? 'Drag files or videos from the drawers to insert them. Ctrl+S to save.'}
            </CardDescription>
            {aiEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAiEditModalOpen(true)}
                title="AI Edit"
                className="flex-shrink-0"
              >
                <Wand2 className="w-4 h-4" />
              </Button>
            )}
          </CardHeader>
        )}
        <CardContent className={fullscreen ? 'flex-1 overflow-hidden' : ''}>
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
              skriptId={skriptId}
              pageId={pageId}
              domain={domain}
              fileList={fileList}
              videoList={videoList}
              fileListLoading={fileListLoading}
              onFileUpload={refreshFileList}
              onAIEdit={aiEdit ? () => setAiEditModalOpen(true) : undefined}
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

      {/* AI Edit modal */}
      {aiEdit && (
        <AIEditModal
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
