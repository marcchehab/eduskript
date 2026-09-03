'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { QuestSpotlight } from '@/components/onboarding/quest-spotlight'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Eye, EyeOff, Pencil, Code, Bold, Italic, Heading, MessageSquare, Heading1, Heading2, Heading3, List, ListOrdered, Link, Palette, Highlighter, Circle, Wand2, ChevronDown, FilePen, Minus, Plus, CircleHelp, TextQuote, Puzzle, Sigma, AlignLeft, AlignCenter, AlignRight, Compass, SeparatorHorizontal, ChartSpline, Table, Image as ImageIcon, Film, FileText, Columns2, Columns3, MoveHorizontal, Pin, AppWindow, Atom, FlaskConical, Terminal, Sparkles, MousePointerClick, ClipboardCheck, Music } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sketch } from '@uiw/react-color'
import { ExcalidrawEditor } from './excalidraw-editor'
import { PluginPicker } from './plugin-picker'
import { GeogebraDialog } from './geogebra-dialog'
import { PictureDialog } from './picture-dialog'
import { VideoPickDialog } from './video-pick-dialog'
import { PdfPickDialog } from './pdf-pick-dialog'
import { InteractivePreview } from './interactive-preview'
import { autocompletion } from '@codemirror/autocomplete'
import { Ribbon, RibbonGroup, RibbonBigButton, RibbonSmallButton, RibbonSmallStack, RibbonSmallRow, RibbonSplitBigButton, RibbonGalleryChip } from '@/components/dashboard/editor-ribbon'
import { createMarkdownCompletions, pageLinkCompletions } from './markdown-completions'
import type { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Strong, Emphasis, Parent } from 'mdast'
import type { VideoInfo } from '@/lib/skript-files'
import { classifyPaste, type PasteMenuOption } from '@/lib/paste-rules'

interface CodeMirrorEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  skriptId?: string
  pageId?: string
  domain?: string
  isReadOnly?: boolean
  fileList?: Array<{id: string, name: string, url?: string, isDirectory?: boolean, updatedAt?: string | Date, width?: number, height?: number}>
  videoList?: VideoInfo[]
  fileListLoading?: boolean
  onFileUpload?: () => void
  onFileDrop?: (file: {
    id: string
    name: string
    url?: string
    isDirectory?: boolean
    rawFile?: File
  }, position: number, screenX: number, screenY: number) => void
  onPasteMenu?: (options: PasteMenuOption[], position: number, screenX: number, screenY: number) => void
  onPasteImageUpload?: (file: File, position: number) => void
  onExcalidrawEdit?: (filename: string, fileId: string) => void
  onAIEdit?: () => void
  /** When true, the AI Edit button is shown grayed with an upgrade tooltip
   *  (free teachers). The click still fires onAIEdit — the parent routes it
   *  to billing. */
  aiEditLocked?: boolean
}

/**
 * First "drawing"/"drawing-2"/"drawing-3"/... name not already taken by a
 * File in this skript. File.name is unique per (parentId, name, skriptId),
 * so a second drawing left on the default name hits a 409 on save — this
 * pre-fills a free one instead of making the teacher rename it by hand.
 */
function nextExcalidrawName(fileList: Array<{ name: string }> | undefined): string {
  const taken = new Set((fileList ?? []).map(f => f.name))
  if (!taken.has('drawing.excalidraw')) return 'drawing'
  let i = 2
  while (taken.has(`drawing-${i}.excalidraw`)) i++
  return `drawing-${i}`
}

// Ribbon dropdown/gallery data. Color cssVars match the rendered classes
// (globals.css); callout vars follow the type→color grouping there (e.g.
// tip shares --callout-important, exercise shares --callout-summary).
const TEXT_COLOR_NAMES = [
  { name: 'red', label: 'Red', cssVar: '--es-color-red' },
  { name: 'orange', label: 'Orange', cssVar: '--es-color-orange' },
  { name: 'lightgreen', label: 'Light green', cssVar: '--es-color-lightgreen' },
  { name: 'green', label: 'Green', cssVar: '--es-color-green' },
  { name: 'cyan', label: 'Cyan', cssVar: '--es-color-cyan' },
  { name: 'lightblue', label: 'Light blue', cssVar: '--es-color-lightblue' },
  { name: 'blue', label: 'Blue', cssVar: '--es-color-blue' },
  { name: 'violet', label: 'Violet', cssVar: '--es-color-violet' },
  { name: 'purple', label: 'Purple', cssVar: '--es-color-purple' },
]

const HIGHLIGHT_NAMES = [
  { name: 'yellow', label: 'Yellow', cssVar: '--es-bg-yellow' },
  { name: 'green', label: 'Green', cssVar: '--es-bg-green' },
  { name: 'blue', label: 'Blue', cssVar: '--es-bg-blue' },
  { name: 'pink', label: 'Pink', cssVar: '--es-bg-pink' },
  { name: 'orange', label: 'Orange', cssVar: '--es-bg-orange' },
  { name: 'red', label: 'Red', cssVar: '--es-bg-red' },
  { name: 'purple', label: 'Purple', cssVar: '--es-bg-purple' },
]

const CALLOUT_GALLERY = [
  { type: 'note', label: 'Note', cssVar: '--callout-note' },
  { type: 'tip', label: 'Tip', cssVar: '--callout-important' },
  { type: 'exercise', label: 'Exercise', cssVar: '--callout-summary' },
  { type: 'warning', label: 'Warning', cssVar: '--callout-warning' },
  { type: 'info', label: 'Info', cssVar: '--callout-info' },
  { type: 'success', label: 'Success / Lernziele', cssVar: '--callout-done' },
  { type: 'danger', label: 'Danger', cssVar: '--callout-danger' },
  { type: 'question', label: 'Question', cssVar: '--callout-question' },
  { type: 'example', label: 'Example', cssVar: '--callout-example' },
  { type: 'quote', label: 'Quote', cssVar: '--callout-quote' },
  { type: 'idea', label: 'Idea', cssVar: '--callout-idea' },
  { type: 'todo', label: 'Todo', cssVar: '--callout-info' },
  { type: 'solution', label: 'Solution', cssVar: '--callout-quote' },
  { type: 'discuss', label: 'Discuss', cssVar: '--callout-discuss' },
]

// Word-style table size picker (Insert > Table hover grid).
function TableGridPicker({ onPick, maxCols = 8, maxRows = 6 }: { onPick: (cols: number, rows: number) => void; maxCols?: number; maxRows?: number }) {
  const [hover, setHover] = useState<{ c: number; r: number }>({ c: 0, r: 0 })
  return (
    <div className="p-2 select-none">
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${maxCols}, 1rem)` }}>
        {Array.from({ length: maxRows }, (_, r) =>
          Array.from({ length: maxCols }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              onMouseEnter={() => setHover({ c: c + 1, r: r + 1 })}
              onClick={() => onPick(c + 1, r + 1)}
              className={`w-4 h-4 border rounded-[2px] ${
                c < hover.c && r < hover.r ? 'bg-primary/30 border-primary' : 'border-border bg-background'
              }`}
            />
          ))
        )}
      </div>
      <div className="text-xs text-muted-foreground text-center mt-1.5">
        {hover.c > 0 ? `${hover.c} × ${hover.r} table` : 'Pick a size'}
      </div>
    </div>
  )
}

const CodeMirrorEditor = function CodeMirrorEditor({
  content,
  onChange,
  skriptId,
  pageId,
  isReadOnly = false,
  fileList,
  videoList,
  onFileUpload,
  onFileDrop,
  onPasteMenu,
  onPasteImageUpload,
  onExcalidrawEdit: onExcalidrawEditProp,
  onAIEdit,
  aiEditLocked = false
}: CodeMirrorEditorProps) {
  const { data: session } = useSession()
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const previewRef = useRef<HTMLDivElement>(null)
  const [editorFontSize, setEditorFontSize] = useState(() => {
    if (typeof window === 'undefined') return 14
    const saved = localStorage.getItem('eduskript:editor-font-size')
    return saved ? parseInt(saved, 10) : 14
  })
  const [editorWidth, setEditorWidth] = useState(50) // Percentage
  // Controlled: the table grid picker is a plain button grid, so Radix
  // doesn't close the menu on click — we close it in onPick.
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Removed previewContent state - React renderer handles markdown directly
  const [isMounted, setIsMounted] = useState(false)
  const [useSimpleEditor, setUseSimpleEditor] = useState(false)
  const [textareaContent, setTextareaContent] = useState(content || '')
  const [dragOver, setDragOver] = useState<false | 'generic' | 'docx' | 'pdf'>(false)
  const [excalidrawOpen, setExcalidrawOpen] = useState(false)
  const [pluginPickerOpen, setPluginPickerOpen] = useState(false)
  const [geogebraDialogOpen, setGeogebraDialogOpen] = useState(false)
  const [pictureDialogOpen, setPictureDialogOpen] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const [excalidrawInitialData, setExcalidrawInitialData] = useState<{
    name: string
    elements: readonly unknown[]
    appState?: unknown
    files?: Record<string, unknown>  // Embedded images
  } | undefined>(undefined)
  const [isEditingExistingExcalidraw, setIsEditingExistingExcalidraw] = useState(false)
  const [showTextColorPicker, setShowTextColorPicker] = useState(false)
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const alert = useAlertDialog()

  // Track current heading/paragraph (refs to avoid re-renders on every keystroke/click)
  const currentHeadingRef = useRef<string>('')
  const selectionStartLineRef = useRef<number>(1)
  const selectionEndLineRef = useRef<number>(1)

  // Debounce ref for selection updates - avoids excessive re-renders while typing
  const selectionDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSelectionRef = useRef<{ start: number; end: number; heading: string } | null>(null)

  // Scroll sync
  const scrollSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isScrollingSyncRef = useRef(false)
  // Track what content the editor last emitted via onChange, so we can
  // distinguish internal changes (which should NOT be dispatched back)
  // from external changes (image resize, version restore) that must be.
  const lastEmittedContentRef = useRef(content || '')
  const fileListRef = useRef(fileList)
  fileListRef.current = fileList

  // Refs for paste callbacks so the CodeMirror paste extension (built once
  // during editor init) sees fresh handlers without rebuilding the editor.
  const onPasteMenuRef = useRef(onPasteMenu)
  onPasteMenuRef.current = onPasteMenu
  const onPasteImageUploadRef = useRef(onPasteImageUpload)
  onPasteImageUploadRef.current = onPasteImageUpload

  // Calculate visibility based on width
  const showEditor = editorWidth > 0
  const showPreview = editorWidth < 100

  // Update the onChange ref when it changes
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Handle file drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()

    // Detect file type from drag items for contextual hint
    const items = Array.from(e.dataTransfer.items)
    const hasDocx = items.some(item =>
      item.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      item.type === 'application/msword'
    )
    const hasPdf = items.some(item => item.type === 'application/pdf')

    if (hasDocx) {
      setDragOver('docx')
    } else if (hasPdf) {
      setDragOver('pdf')
    } else {
      setDragOver('generic')
    }

    // Update cursor position based on mouse position during drag
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
      if (pos !== null) {
        // Update selection to show where the file will be inserted
        view.dispatch({
          selection: { anchor: pos, head: pos }
        })
      }
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    // Get drop position from mouse coordinates
    let dropPosition = null
    if (editorViewRef.current && !useSimpleEditor) {
      dropPosition = editorViewRef.current.posAtCoords({ x: e.clientX, y: e.clientY })
    }

    // Check if it's a file from the file browser (has custom data)
    const fileData = e.dataTransfer.getData('application/Eduskript-file')
    if (fileData) {
      try {
        const file = JSON.parse(fileData)
        // Use onFileDrop callback if available (allows showing insertion menu)
        if (onFileDrop && dropPosition !== null) {
          onFileDrop(file, dropPosition, e.clientX, e.clientY)
        } else {
          // Fallback to direct insertion
          insertFileAtPosition(file, dropPosition)
        }
        return
      } catch (error) {
        console.error('Error parsing file data:', error)
      }
    }

    // Check if it's a Mux video dragged from the video browser
    const muxVideoData = e.dataTransfer.getData('application/Eduskript-mux-video')
    if (muxVideoData) {
      try {
        const video = JSON.parse(muxVideoData)
        const insertText = `![](${video.filename})`
        if (editorViewRef.current && !useSimpleEditor) {
          const view = editorViewRef.current
          const insertPos = dropPosition !== null && dropPosition !== undefined ? dropPosition : view.state.selection.main.head
          const transaction = view.state.update({
            changes: { from: insertPos, insert: insertText },
            selection: { anchor: insertPos + insertText.length }
          })
          view.dispatch(transaction)
          onChange(view.state.doc.toString())
        }
        return
      } catch (error) {
        console.error('Error parsing mux video data:', error)
      }
    }

    // Handle computer file drops
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && skriptId) {
      // Size limits
      const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB max
      const DIRECT_UPLOAD_THRESHOLD = 10 * 1024 * 1024 // 10MB - use direct S3 upload for larger files

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          alert.showError(`File "${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 500MB.`)
          return
        }
      }

      try {
        for (const file of files) {
          const extension = file.name.split('.').pop()?.toLowerCase()

          // DOCX: extract content as markdown and insert directly
          if (extension === 'docx') {
            try {
              const arrayBuffer = await file.arrayBuffer()
              const mammoth = await import('mammoth')
              const result = await mammoth.convertToHtml({ arrayBuffer })
              if (result.messages.length > 0) {
                console.warn('Mammoth conversion warnings:', result.messages)
              }
              const TurndownService = (await import('turndown')).default
              const { gfm } = await import('turndown-plugin-gfm')
              const turndown = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
              })
              turndown.use(gfm)
              const markdown = turndown.turndown(result.value)

              if (editorViewRef.current && !useSimpleEditor) {
                const view = editorViewRef.current
                const insertPos = dropPosition !== null && dropPosition !== undefined ? dropPosition : view.state.selection.main.head
                const transaction = view.state.update({
                  changes: { from: insertPos, insert: markdown },
                  selection: { anchor: insertPos + markdown.length }
                })
                view.dispatch(transaction)
                onChange(view.state.doc.toString())
              } else if (useSimpleEditor) {
                const textarea = document.querySelector('textarea') as HTMLTextAreaElement
                if (textarea) {
                  const start = textarea.selectionStart
                  const newContent = textareaContent.substring(0, start) + markdown + textareaContent.substring(start)
                  setTextareaContent(newContent)
                  onChange(newContent)
                }
              }
            } catch (error) {
              console.error('Error extracting DOCX content:', error)
              alert.showError('Failed to extract DOCX content. The file may be corrupted.')
            }
            continue
          }

          // PDF: show context menu without uploading — upload deferred to menu handler
          if (extension === 'pdf') {
            if (onFileDrop && dropPosition !== null) {
              onFileDrop({ id: '', name: file.name, rawFile: file }, dropPosition, e.clientX, e.clientY)
            } else {
              // Fallback: upload and insert directly as single-page embed
              let uploadedFile
              if (file.size > DIRECT_UPLOAD_THRESHOLD) {
                uploadedFile = await uploadDirectToS3(file, skriptId)
              } else {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('uploadType', 'skript')
                formData.append('skriptId', skriptId)
                const response = await fetch('/api/upload', { method: 'POST', body: formData })
                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
                  throw new Error(errorData.error || 'Upload failed')
                }
                uploadedFile = await response.json()
              }
              insertFileAtPosition(uploadedFile, dropPosition)
              if (onFileUpload) onFileUpload()
            }
            continue
          }

          // Standard file upload for everything else
          let uploadedFile

          if (file.size > DIRECT_UPLOAD_THRESHOLD) {
            // Large file - use direct S3 upload
            uploadedFile = await uploadDirectToS3(file, skriptId)
          } else {
            // Small file - use standard upload
            const formData = new FormData()
            formData.append('file', file)
            formData.append('uploadType', 'skript')
            formData.append('skriptId', skriptId)

            const response = await fetch('/api/upload', {
              method: 'POST',
              body: formData,
            })

            if (!response.ok) {
              try {
                const errorData = await response.json()
                throw new Error(errorData.error || 'Upload failed')
              } catch (e) {
                if (e instanceof Error && e.message !== 'Upload failed') throw e
                throw new Error(`Upload failed (status ${response.status})`)
              }
            }

            uploadedFile = await response.json()
          }

          if (uploadedFile.existed) {
            alert.showInfo('A file with this name already existed in this skript and was embedded. Rename or delete the existing file to re-upload.', 'Existing file used')
          }

          insertFileAtPosition(uploadedFile, dropPosition)
          if (onFileUpload) {
            onFileUpload()
          }
        }
      } catch (error) {
        console.error('Error uploading dropped files:', error)
        alert.showError(error instanceof Error ? error.message : 'Failed to upload file. Please try again.')
      }
    }
  }

  // Upload large files directly to S3 via presigned URL
  const uploadDirectToS3 = async (file: File, targetSkriptId: string) => {
    // Step 1: Get presigned URL
    const presignedResponse = await fetch('/api/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        skriptId: targetSkriptId
      })
    })

    if (!presignedResponse.ok) {
      const error = await presignedResponse.json().catch(() => ({ error: 'Failed to get upload URL' }))
      throw new Error(error.error || 'Failed to get upload URL')
    }

    const { uploadUrl, uploadToken, uploadData, signature } = await presignedResponse.json()

    // Step 2: Upload directly to S3
    const s3Response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    })

    if (!s3Response.ok) {
      throw new Error(`S3 upload failed: ${s3Response.status} ${s3Response.statusText}`)
    }

    // Step 3: Confirm upload
    const confirmResponse = await fetch('/api/upload/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadToken, uploadData, signature })
    })

    if (!confirmResponse.ok) {
      const error = await confirmResponse.json().catch(() => ({ error: 'Failed to confirm upload' }))
      throw new Error(error.error || 'Failed to confirm upload')
    }

    return await confirmResponse.json()
  }

  // Insert file at specific position (or cursor if no position provided)
  const insertFileAtPosition = (file: { id: string; name?: string; filename?: string; url?: string; isDirectory?: boolean }, position?: number | null) => {
    if (file.isDirectory) return // Don't insert directories

    let insertText = ''

    // Determine the type of insert based on file extension
    // Handle both 'name' and 'filename' properties for backward compatibility
    const fileName = file.name || file.filename
    if (!fileName) {
      console.error('File has no name property:', file)
      return
    }
    const extension = fileName.split('.').pop()?.toLowerCase()
    
    if (extension === 'pdf') {
      // PDF - embed using custom element, filename resolved at render time
      insertText = `<pdf src="${fileName}" height="1267"></pdf>`
    } else if (['sqlite', 'db'].includes(extension || '')) {
      // Database file - insert SQL editor block
      insertText = `\`\`\`sql editor id="${generateId()}" db="${fileName}"\n-- Show all tables in the database\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\n\`\`\``
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Image - empty alt by default. The markdown pipeline renders alt as a
      // figcaption beneath the image; the basename is rarely the right
      // caption. Authors add one manually when they want one.
      insertText = `![](${fileName})`
    } else if (extension === 'excalidraw') {
      // Excalidraw drawing - use image syntax with just filename
      insertText = `![](${fileName})`
    } else if (['mp4', 'mov'].includes(extension || '')) {
      // Mux-hosted video reference, resolved at render time via remarkMuxVideo
      // (same as editor-with-media's file panel).
      insertText = `![](${fileName})`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Bare filename; markdown-components' AudioComponent resolves it to the
      // current file URL at render time.
      insertText = `<audio controls src="${fileName}"></audio>`
    } else {
      // Generic file/download link. Bare filename, resolved to the current
      // file URL at render time (markdown-components AnchorComponent); label is
      // the basename without extension.
      insertText = `[${fileName.replace(/\.[^.]+$/, '')}](${fileName})`
    }

    if (editorViewRef.current && !useSimpleEditor) {
      // Insert at specific position or current cursor position in CodeMirror
      const view = editorViewRef.current
      const insertPos = position !== null && position !== undefined ? position : view.state.selection.main.head
      const transaction = view.state.update({
        changes: { from: insertPos, insert: insertText },
        selection: { anchor: insertPos + insertText.length }
      })
      view.dispatch(transaction)
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      // Insert at cursor position in textarea
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newContent = textareaContent.substring(0, start) + insertText + textareaContent.substring(end)
        setTextareaContent(newContent)
        onChange(newContent)
        // Restore cursor position after the inserted text
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertText.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Handle splitter drag (mouse)
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  // Handle splitter drag (touch)
  const handleSplitterTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Snap to edges if dragged past threshold, otherwise clamp to 10-90%
      if (newEditorWidth > 92) {
        setEditorWidth(100) // Snap to hide preview
      } else if (newEditorWidth < 8) {
        setEditorWidth(0) // Snap to hide editor
      } else {
        setEditorWidth(Math.max(10, Math.min(90, newEditorWidth)))
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!containerRef.current || !e.touches[0]) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.touches[0].clientX - containerRect.left) / containerRect.width) * 100

      // Snap to edges if dragged past threshold, otherwise clamp to 10-90%
      if (newEditorWidth > 92) {
        setEditorWidth(100) // Snap to hide preview
      } else if (newEditorWidth < 8) {
        setEditorWidth(0) // Snap to hide editor
      } else {
        setEditorWidth(Math.max(10, Math.min(90, newEditorWidth)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    const handleTouchEnd = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [isDragging])

  // Allow natural scrolling - browser handles it correctly
  // CodeMirror's .cm-scroller has overflow, so it scrolls internally when needed
  // When content doesn't overflow, the wheel event naturally bubbles to page scroll

  // Fallback for content
  const editorContent = content || ''

  // Ensure component is mounted
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // No longer need to process markdown for preview - React renderer handles it
  // Just pass the raw markdown to InteractivePreview
  useEffect(() => {
    if (!isMounted || !editorRef.current) return

    // Set a hard timeout to fallback to simple editor
    const fallbackTimeout = setTimeout(() => {
      setUseSimpleEditor(true)
    }, 5000) // Increased timeout to 5 seconds

    const initializeCodeMirror = async () => {
      try {
        // Clean up existing editor first
        if (editorViewRef.current) {
          editorViewRef.current.destroy()
          editorViewRef.current = null
        }
        
        // Try to import CodeMirror modules one by one with better error handling
        const { basicSetup } = await import('codemirror')
        const { EditorView, keymap } = await import('@codemirror/view')
        const { EditorState } = await import('@codemirror/state')
        const { indentWithTab } = await import('@codemirror/commands')

        // Toggle "> " prefix on all selected lines (Ctrl/Cmd+Shift+.)
        const toggleBlockquoteCmd = ({ state, dispatch }: { state: (typeof EditorState)['prototype'], dispatch: InstanceType<typeof EditorView>['dispatch'] }) => {
          const { from, to } = state.selection.main
          const lines = []
          for (let pos = from; pos <= to;) {
            const line = state.doc.lineAt(pos)
            lines.push(line)
            pos = line.to + 1
          }
          const allQuoted = lines.every(l => l.text.startsWith('> '))
          dispatch(state.update({
            changes: lines.map(line => allQuoted
              ? { from: line.from, to: line.from + 2, insert: '' }
              : { from: line.from, insert: '> ' }
            ),
            userEvent: 'input',
          }))
          return true
        }
        const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown')
        const { LanguageDescription } = await import('@codemirror/language')
        
        // Language support
        const { javascript } = await import('@codemirror/lang-javascript')
        const { python } = await import('@codemirror/lang-python')
        const { sql } = await import('@codemirror/lang-sql')
        const { php } = await import('@codemirror/lang-php')
        const { java } = await import('@codemirror/lang-java')
        const { cpp } = await import('@codemirror/lang-cpp')
        const { rust } = await import('@codemirror/lang-rust')
        const { go } = await import('@codemirror/lang-go')
        const { html } = await import('@codemirror/lang-html')
        const { css } = await import('@codemirror/lang-css')
        const { json } = await import('@codemirror/lang-json')
        const { xml } = await import('@codemirror/lang-xml')
        const { yaml } = await import('@codemirror/lang-yaml')
        
        // Load theme extensions
        const { vsCodeLight } = await import('@fsegurai/codemirror-theme-vscode-light')
        const { vsCodeDark } = await import('@fsegurai/codemirror-theme-vscode-dark')
        
        // Create enhanced markdown with language support
        const markdownExtension = markdown({
          base: markdownLanguage, // Use GFM-enabled markdown language
          codeLanguages: [
            LanguageDescription.of({ name: 'javascript', alias: ['js'], support: javascript() }),
            LanguageDescription.of({ name: 'typescript', alias: ['ts'], support: javascript({ typescript: true }) }),
            LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
            LanguageDescription.of({ name: 'sql', support: sql() }),
            LanguageDescription.of({ name: 'php', support: php() }),
            LanguageDescription.of({ name: 'java', support: java() }),
            LanguageDescription.of({ name: 'cpp', alias: ['c++', 'c'], support: cpp() }),
            LanguageDescription.of({ name: 'rust', alias: ['rs'], support: rust() }),
            LanguageDescription.of({ name: 'go', support: go() }),
            LanguageDescription.of({ name: 'html', support: html() }),
            LanguageDescription.of({ name: 'css', support: css() }),
            LanguageDescription.of({ name: 'json', support: json() }),
            LanguageDescription.of({ name: 'xml', support: xml() }),
            LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
          ]
        })
        
        const startState = EditorState.create({
          doc: editorContent,
          extensions: [
            basicSetup,
            keymap.of([indentWithTab, { key: 'Mod-Shift-.', run: toggleBlockquoteCmd }]), // Tab + blockquote toggle
            markdownExtension,
            autocompletion({
              override: [
                createMarkdownCompletions(() => fileListRef.current || []),
                pageLinkCompletions,
              ],
              activateOnTyping: true,
              maxRenderedOptions: 15,
            }),
            ...(isDark ? [vsCodeDark] : [vsCodeLight]),
            EditorView.updateListener.of((update: ViewUpdate) => {
              if (update.docChanged) {
                const newContent = update.state.doc.toString()
                lastEmittedContentRef.current = newContent
                onChange(newContent)
              }

              // Track selection range and current heading (debounced to avoid re-renders while typing)
              if (update.selectionSet || update.docChanged) {
                const { state } = update
                const selection = state.selection.main

                // Get start and end lines of selection
                const startLine = state.doc.lineAt(selection.from).number
                const endLine = state.doc.lineAt(selection.to).number

                // Find the current heading by searching backwards from cursor
                const text = state.doc.toString()
                const lines = text.split('\n')
                let heading = ''

                for (let i = startLine - 1; i >= 0; i--) {
                  const line = lines[i]
                  const match = line.match(/^(#{1,6})\s+(.+)/)
                  if (match) {
                    heading = match[2] // Extract heading text without the #
                    break
                  }
                }

                // Store pending values and debounce the state updates
                pendingSelectionRef.current = { start: startLine, end: endLine, heading: heading || 'Top of document' }

                // Clear existing debounce
                if (selectionDebounceRef.current) {
                  clearTimeout(selectionDebounceRef.current)
                }

                // Apply ref updates and highlight after 100ms of inactivity
                selectionDebounceRef.current = setTimeout(() => {
                  const pending = pendingSelectionRef.current
                  if (pending) {
                    selectionStartLineRef.current = pending.start
                    selectionEndLineRef.current = pending.end
                    currentHeadingRef.current = pending.heading
                    highlightCurrentParagraph()
                  }
                }, 100)
              }
            }),
            EditorView.theme({
              '&': {
                height: '100%',
              },
              '.cm-content': {
                padding: '12px',
                fontSize: `${editorFontSize}px`,
                lineHeight: '1.5',
                minHeight: '100%',
              },
              '.cm-focused': {
                outline: 'none',
              },
              '.cm-editor': {
                borderRadius: '8px',
                height: '100%',
              },
              '.cm-scroller': {
                minHeight: '100%',
              },
              '.cm-line': {
                overflowWrap: 'break-word', // Standard property, safer than word-break for CM
              },
            }),
            EditorView.lineWrapping, // Add line wrapping extension
            // Paste-helper: classify clipboard contents, then either insert
            // markdown directly, open the contextual menu, or upload an
            // image blob. See src/lib/paste-rules.ts for the rules. Returns
            // false (and does not preventDefault) when no rule matches, so
            // plain-text paste keeps its default behaviour.
            EditorView.domEventHandlers({
              paste(event, view) {
                if (!event.clipboardData) return false
                const intent = classifyPaste(event.clipboardData)
                if (!intent) return false

                const cursor = view.state.selection.main.head

                if (intent.kind === 'insert') {
                  view.dispatch(view.state.update({
                    changes: { from: cursor, insert: intent.text },
                    selection: { anchor: cursor + intent.text.length },
                    userEvent: 'input.paste',
                  }))
                  event.preventDefault()
                  return true
                }

                if (intent.kind === 'menu') {
                  const cb = onPasteMenuRef.current
                  if (!cb) return false
                  const coords = view.coordsAtPos(cursor)
                  // coordsAtPos can return null if the position is off-screen.
                  // Fall back to the editor's top-left corner in that case.
                  const rect = view.dom.getBoundingClientRect()
                  const x = coords?.left ?? rect.left
                  const y = coords?.bottom ?? rect.top
                  cb(intent.options, cursor, x, y)
                  event.preventDefault()
                  return true
                }

                if (intent.kind === 'upload-image') {
                  const cb = onPasteImageUploadRef.current
                  if (!cb) return false
                  cb(intent.file, cursor)
                  event.preventDefault()
                  return true
                }

                return false
              },
            }),
            // Catch CM tile tree crashes ("parents.pop() is undefined") and recover
            // by forcing a full re-measure. Without this, the editor becomes unusable
            // after the error (offset cursor, phantom lines, visual corruption).
            EditorView.exceptionSink.of((error) => {
              const msg = error?.message || ''
              if (msg.includes('pop') || msg.includes('No tile at position') || msg.includes('undefined has no properties')) {
                console.warn('[CodeMirror] Tile tree error caught, forcing re-measure:', msg)
                // Schedule recovery after the current call stack clears
                setTimeout(() => {
                  if (editorViewRef.current) {
                    editorViewRef.current.requestMeasure()
                    editorViewRef.current.dispatch({})
                  }
                }, 0)
              } else {
                console.error('[CodeMirror] Unhandled error:', error)
              }
            }),
          ],
        })

        // Clear the container before creating new editor
        if (editorRef.current) {
          editorRef.current.innerHTML = ''
        }
        
        const view = new EditorView({
          state: startState,
          parent: editorRef.current!,
        })

        editorViewRef.current = view
        clearTimeout(fallbackTimeout)

        return () => {
          view.destroy()
          editorViewRef.current = null
        }
      } catch (error) {
        console.error('Error loading CodeMirror:', error)
        if (error instanceof Error) {
          console.error('Error details:', error.message)
          console.error('Error stack:', error.stack)
        }
        clearTimeout(fallbackTimeout)
        setUseSimpleEditor(true)
      }
    }

    initializeCodeMirror()

    // Cleanup function
    return () => {
      clearTimeout(fallbackTimeout)
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, isDark]) // Only re-initialize when mounted state or theme changes

  // Update editor font size dynamically.
  // Must use requestMeasure() after DOM change so CM recalculates tile positions.
  useEffect(() => {
    if (editorViewRef.current) {
      const cmContent = editorViewRef.current.dom.querySelector('.cm-content') as HTMLElement
      if (cmContent) {
        cmContent.style.fontSize = `${editorFontSize}px`
        editorViewRef.current.requestMeasure()
      }
    }
  }, [editorFontSize])

  // Update editor content when prop changes from an EXTERNAL source
  // (e.g., image resize in preview, version restore).
  // Skip if editorContent matches what the editor last emitted via onChange —
  // dispatching the editor's own output back into it corrupts the tile tree
  // (causes "parents.pop() is undefined" errors, phantom lines, cursor drift).
  useEffect(() => {
    if (editorContent === lastEmittedContentRef.current) return
    if (editorViewRef.current && editorContent !== editorViewRef.current.state.doc.toString()) {
      try {
        const view = editorViewRef.current
        // Preserve cursor position
        const cursorPos = view.state.selection.main.head
        const cursorLine = view.state.doc.lineAt(cursorPos).number

        const transaction = view.state.update({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: editorContent,
          },
        })
        view.dispatch(transaction)
        lastEmittedContentRef.current = editorContent

        // Restore cursor to same line (clamped to new doc length)
        requestAnimationFrame(() => {
          if (!editorViewRef.current) return
          const newView = editorViewRef.current
          const newDoc = newView.state.doc
          // Try to restore to same line number, clamped to valid range
          const targetLine = Math.min(cursorLine, newDoc.lines)
          const line = newDoc.line(targetLine)
          newView.dispatch({
            selection: { anchor: line.from },
          })
        })
      } catch (error) {
        console.error('Error updating editor content:', error)
      }
    }
  }, [editorContent])

  // Refresh CodeMirror when editor becomes visible
  useEffect(() => {
    if (showEditor && editorViewRef.current && !useSimpleEditor) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        if (editorViewRef.current) {
          // Force a full layout recalculation
          editorViewRef.current.requestMeasure()
          // Also dispatch an empty transaction to force a redraw
          editorViewRef.current.dispatch({})
        }
      }, 0)
    }
  }, [showEditor, useSimpleEditor])

  // Scroll synchronization between editor and preview
  useEffect(() => {
    if (!isMounted || (!showEditor || !showPreview)) return

    const editorScroller = editorRef.current?.querySelector('.cm-scroller')
    const previewScroller = previewRef.current

    if (!editorScroller || !previewScroller) return

    const syncScroll = (source: Element, target: Element) => {
      if (isScrollingSyncRef.current) return

      isScrollingSyncRef.current = true

      // Clear existing timeout
      if (scrollSyncTimeoutRef.current) {
        clearTimeout(scrollSyncTimeoutRef.current)
      }

      // Calculate scroll percentage
      const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight)

      // Apply to target
      const targetScrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight)
      target.scrollTo({ top: targetScrollTop, behavior: 'auto' })

      // Reset flag after a short delay
      scrollSyncTimeoutRef.current = setTimeout(() => {
        isScrollingSyncRef.current = false
      }, 100)
    }

    const handleEditorScroll = () => syncScroll(editorScroller, previewScroller)
    const handlePreviewScroll = () => syncScroll(previewScroller, editorScroller)

    editorScroller.addEventListener('scroll', handleEditorScroll, { passive: true })
    previewScroller.addEventListener('scroll', handlePreviewScroll, { passive: true })

    return () => {
      editorScroller.removeEventListener('scroll', handleEditorScroll)
      previewScroller.removeEventListener('scroll', handlePreviewScroll)
      if (scrollSyncTimeoutRef.current) {
        clearTimeout(scrollSyncTimeoutRef.current)
      }
    }
  }, [isMounted, showEditor, showPreview, useSimpleEditor])

  // Highlight current paragraph(s) in preview — called directly from selection debounce
  const highlightCurrentParagraph = useCallback(() => {
    if (!previewRef.current || !showPreview) return

    const selectionStart = selectionStartLineRef.current
    const selectionEnd = selectionEndLineRef.current

    requestAnimationFrame(() => {
      if (!previewRef.current) return

      const allElements = previewRef.current.querySelectorAll('[data-source-line-start]')

      // Remove previous highlights
      allElements.forEach(element => {
        element.classList.remove('editor-current-paragraph')
      })

      // Find all elements that overlap with the selection range
      const matchingElements: Element[] = []
      allElements.forEach(element => {
        const elementStart = parseInt(element.getAttribute('data-source-line-start') || '0', 10)
        const elementEnd = parseInt(element.getAttribute('data-source-line-end') || '0', 10)

        if (elementStart <= selectionEnd && elementEnd >= selectionStart) {
          matchingElements.push(element)
        }
      })

      // Highlight all matching elements
      matchingElements.forEach(element => {
        element.classList.add('editor-current-paragraph')
      })

      // Scroll first matching element into view if it's not visible
      if (matchingElements.length > 0) {
        const firstElement = matchingElements[0] as HTMLElement
        const container = previewRef.current
        const containerRect = container.getBoundingClientRect()
        const elementRect = firstElement.getBoundingClientRect()

        if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
          // Scroll ONLY the preview pane. scrollIntoView would also scroll
          // every other scrollable ancestor, nudging the page and clipping
          // the ribbon tab bar.
          const delta = elementRect.top - containerRect.top - (containerRect.height - elementRect.height) / 2
          container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
        }
      }
    })
  }, [showPreview])

  // Handle click on preview to jump to source line in editor
  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Don't handle if editor is not shown or not using CodeMirror
    if (!showEditor || useSimpleEditor || !editorViewRef.current) return

    // Don't interfere with interactive elements (buttons, inputs, links, etc.)
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, a, [role="button"], .code-editor, [data-interactive]')) {
      return
    }

    // Find the nearest element with source line data
    const elementWithLine = target.closest('[data-source-line-start]') as HTMLElement | null
    if (!elementWithLine) return

    const lineNumber = parseInt(elementWithLine.getAttribute('data-source-line-start') || '0', 10)
    if (lineNumber <= 0) return

    // Get the position at the start of that line in CodeMirror
    const view = editorViewRef.current
    try {
      const line = view.state.doc.line(lineNumber)

      // Set cursor to the start of the line
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      })

      // Focus the editor
      view.focus()
    } catch (err) {
      // Line number out of range - content may have changed
      console.debug('Could not jump to line:', lineNumber, err)
    }
  }, [showEditor, useSimpleEditor])

  // Handle textarea change for simple editor
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setTextareaContent(newContent)
    onChange(newContent)
  }

  const generateId = () => Math.random().toString(36).slice(2, 7)

  // Insert code editor block
  const insertCodeEditor = () => {
    // Pre-fill an explicit id so saves persist across markdown edits. Without
    // an explicit id the editor falls back to a content-hash-derived one,
    // which flips whenever the starter code changes and orphans the saves.
    const codeEditorTemplate = `\`\`\`python editor id="${generateId()}"\n# Write your Python code here\nprint("Hello, World!")\n\`\`\`\n`

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      const transaction = view.state.update({
        changes: { from: insertPos, insert: codeEditorTemplate },
        selection: { anchor: insertPos + codeEditorTemplate.length }
      })
      view.dispatch(transaction)
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + codeEditorTemplate + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + codeEditorTemplate.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Insert quiz question block
  const insertQuiz = () => {
    const quizTemplate = `<question id="${generateId()}" type="single">\nQuestion text\n\n<answer correct>Correct answer</answer>\n<answer>Wrong answer</answer>\n</question>\n`

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      const transaction = view.state.update({
        changes: { from: insertPos, insert: quizTemplate },
        selection: { anchor: insertPos + quizTemplate.length }
      })
      view.dispatch(transaction)
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + quizTemplate + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + quizTemplate.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Insert a <spacer> writing area. An explicit id keys the round-trip
  // find/replace when the student/teacher resizes or restyles it in the preview.
  // Maths tab inserts graph paper (checkered) for handwork; Layout inserts a
  // blank spacer (plain vertical whitespace).
  const insertSpacer = (pattern: 'checkered' | 'blank' = 'checkered') => {
    const spacerTemplate = `<spacer id="${generateId()}" pattern="${pattern}" height="200" />\n`

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      const transaction = view.state.update({
        changes: { from: insertPos, insert: spacerTemplate },
        selection: { anchor: insertPos + spacerTemplate.length }
      })
      view.dispatch(transaction)
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + spacerTemplate + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + spacerTemplate.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Insert a ```plot fence. The starter shows the features an author would
  // otherwise have to look up — a second curve with colour/style/label, marked
  // points — rather than the shortest possible plot.
  const insertPlot = () => {
    const template =
      '```plot\n' +
      'x: -4..4\n' +
      'y: -3..3\n' +
      'grid\n' +
      'f(x) = 1/3x^3 - x\n' +
      'g(x) = x^2 - 1, red, dashed, label="f\'(x)"\n' +
      'A = (-1, 2/3), label="H"\n' +
      'B = (1, -2/3), label="T"\n' +
      '```\n'

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      view.dispatch(
        view.state.update({
          changes: { from: insertPos, insert: template },
          selection: { anchor: insertPos + template.length },
        })
      )
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + template + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + template.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Insert plugin from picker
  const insertPlugin = (pluginSrc: string, configHint: string) => {
    const pluginTag = `<plugin src="${pluginSrc}"${configHint} />\n`

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      const transaction = view.state.update({
        changes: { from: insertPos, insert: pluginTag },
        selection: { anchor: insertPos + pluginTag.length },
      })
      view.dispatch(transaction)
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + pluginTag + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + pluginTag.length
          textarea.focus()
        }, 0)
      }
    }
  }

  const insertGeogebra = (materialId: string) => {
    const tag = `<geogebra material-id="${materialId}" />\n`

    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      view.dispatch(view.state.update({
        changes: { from: insertPos, insert: tag },
        selection: { anchor: insertPos + tag.length },
      }))
      onChange(view.state.doc.toString())
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + tag + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + tag.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Handle Excalidraw save
  const handleExcalidrawSave = async (
    name: string,
    excalidrawData: string,
    lightSvg: string,
    darkSvg: string,
    originalName: string | undefined,
  ) => {
    if (!skriptId) {
      alert.showError('Skript ID is required to save drawings')
      return
    }

    const response = await fetch('/api/excalidraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        excalidrawData,
        lightSvg,
        darkSvg,
        skriptId,
        originalName,
      }),
    })

    if (!response.ok) {
      // Re-throw with the server's message so the editor's alert shows the
      // real reason (e.g. filename collision) instead of a generic string.
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save drawing')
    }

    // Only insert the reference on the FIRST save of a new drawing.
    // originalName is set both when editing an existing drawing and on
    // re-saves within one session (the editor tracks its last saved name).
    if (!originalName) {
      const insertText = `![](${name}.excalidraw)\n`

      if (editorViewRef.current && !useSimpleEditor) {
        const view = editorViewRef.current
        const insertPos = view.state.selection.main.head
        const transaction = view.state.update({
          changes: { from: insertPos, insert: insertText },
          selection: { anchor: insertPos + insertText.length }
        })
        view.dispatch(transaction)
        onChange(view.state.doc.toString())
      } else if (useSimpleEditor) {
        const textarea = document.querySelector('textarea') as HTMLTextAreaElement
        if (textarea) {
          const start = textarea.selectionStart
          const newContent = textareaContent.substring(0, start) + insertText + textareaContent.substring(start)
          setTextareaContent(newContent)
          onChange(newContent)
        }
      }
    }

    // Refresh file list
    if (onFileUpload) {
      onFileUpload()
    }
  }

  // Handle editing an existing Excalidraw drawing (from preview or file browser)
  const handleExcalidrawEdit = async (filename: string, fileId: string) => {
    if (!skriptId) {
      alert.showError('Cannot edit drawing: no skript context')
      return
    }

    try {
      // Fetch the .excalidraw file data (direct S3 URL, CORS configured)
      const file = fileList?.find(f => f.id === fileId)
      const baseUrl = file?.url || `/api/files/${fileId}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const fileUrl = `${baseUrl}${separator}v=${Date.now()}`
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch drawing data (${response.status})`)
      }

      const text = await response.text()

      // Parse the Excalidraw data - supports both pure JSON and Obsidian format
      let excalidrawData
      try {
        excalidrawData = JSON.parse(text)
      } catch {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          excalidrawData = JSON.parse(jsonMatch[1])
        } else {
          throw new Error('Could not parse Excalidraw data')
        }
      }

      // Derive name from filename, stripping .excalidraw extension
      const name = filename.replace(/\.excalidraw$/, '')

      // Set initial data and open editor (mark as editing existing file)
      setExcalidrawInitialData({
        name,
        elements: excalidrawData.elements || [],
        appState: excalidrawData.appState,
        files: excalidrawData.files  // Include embedded images
      })
      setIsEditingExistingExcalidraw(true)
      setExcalidrawOpen(true)
    } catch (error) {
      console.error('Error loading drawing:', error)
      alert.showError('Failed to load drawing for editing')
    }
  }

  // Formatting helpers
  const wrapSelection = (prefix: string, suffix: string = prefix) => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const { from, to } = view.state.selection.main
      const selectedText = view.state.doc.sliceString(from, to)
      const wrappedText = `${prefix}${selectedText}${suffix}`

      view.dispatch({
        changes: { from, to, insert: wrappedText },
        selection: { anchor: from + prefix.length, head: to + prefix.length }
      })
      view.focus()
    }
  }

  const insertAtCursor = (text: string) => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const pos = view.state.selection.main.head

      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length }
      })
      view.focus()
    }
  }

  // Insert a block template at the cursor. Unlike insertAtCursor this also
  // works in the simple-textarea fallback (same pattern as insertQuiz).
  // Templates should match markdown-completions.ts / syntax-reference.ts.
  const insertBlockTemplate = (template: string) => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const insertPos = view.state.selection.main.head
      view.dispatch({
        changes: { from: insertPos, insert: template },
        selection: { anchor: insertPos + template.length }
      })
      onChange(view.state.doc.toString())
      view.focus()
    } else if (useSimpleEditor) {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        const start = textarea.selectionStart
        const newContent = textareaContent.substring(0, start) + template + textareaContent.substring(start)
        setTextareaContent(newContent)
        onChange(newContent)
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + template.length
          textarea.focus()
        }, 0)
      }
    }
  }

  // Excel-style placeholder content (A1, B1… / A2, B2…) so the row/column
  // structure is obvious in the source.
  const insertTable = (cols: number, rows: number) => {
    const colLetter = (i: number) => String.fromCharCode(65 + i)
    const header = `| ${Array.from({ length: cols }, (_, c) => `Column ${c + 1}`).join(' | ')} |`
    const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
    const body = Array.from({ length: rows }, (_, r) =>
      `| ${Array.from({ length: cols }, (_, c) => `${colLetter(c)}${r + 1}`).join(' | ')} |`
    ).join('\n')
    insertBlockTemplate(`\n${header}\n${sep}\n${body}\n`)
  }
  const insertFlex = () => insertBlockTemplate('\n<flex>\n<flex-item>\n\nLeft column — put text, images, or any markdown here.\n\n</flex-item>\n<flex-item>\n\nRight column — the columns share the width equally.\n\n</flex-item>\n</flex>\n')
  const insertFullwidth = () => insertBlockTemplate('\n<fullwidth>\n\n</fullwidth>\n')
  const insertStickme = () => insertBlockTemplate('\n<stickme>\n\n</stickme>\n')
  const insertTabsContainer = () => insertBlockTemplate('\n<tabs-container data-items=\'["Tab 1","Tab 2"]\'>\n<tab-item>\n\n</tab-item>\n<tab-item>\n\n</tab-item>\n</tabs-container>\n')
  const insertSqlEditor = () => insertBlockTemplate(`\`\`\`sql editor id="${generateId()}" db=""\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\n\`\`\`\n`)
  const insertHtmlEditor = () => insertBlockTemplate(`\`\`\`html editor id="${generateId()}"\n<h1>Hello!</h1>\n\`\`\`\n`)
  const insertPlainCodeBlock = () => insertBlockTemplate('```python\n\n```\n')
  const insertPythonCheck = () => insertBlockTemplate('```python-check for=""\nassert True, "Explain what is checked"\n```\n')
  const insertPing = () => insertBlockTemplate('<ping />\n')
  const insertMolecule = () => insertBlockTemplate('<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />\n')
  const insertReaction = () => insertBlockTemplate('$$\\ce{2H2 + O2 -> 2H2O}$$\n')
  const insertAiFeedback = () => insertBlockTemplate('<ai-feedback prompt="Check the work in this section. Point out the first error, do not reveal the solution." />\n')
  const insertCta = () => insertBlockTemplate('<cta href="https://eduskript.org">Visit Eduskript</cta>\n')
  const insertAudio = () => insertBlockTemplate('<audio controls src=""></audio>\n')

  /**
   * Find an enclosing emphasis or strong node at the given cursor position.
   * Returns the node and its absolute start/end offsets if found.
   */
  const findEnclosingFormatNode = (
    doc: string,
    cursorPos: number,
    nodeType: 'strong' | 'emphasis'
  ): { node: Strong | Emphasis; start: number; end: number } | null => {
    try {
      const tree = fromMarkdown(doc)

      // Recursively search for the node type containing the cursor
      const findNode = (
        parent: Parent,
        target: number
      ): { node: Strong | Emphasis; start: number; end: number } | null => {
        for (const child of parent.children) {
          if (!child.position) continue

          const start = child.position.start.offset ?? 0
          const end = child.position.end.offset ?? 0

          // Check if cursor is within this node's range
          if (target >= start && target <= end) {
            // If this is the node type we're looking for, return it
            if (child.type === nodeType) {
              return { node: child as Strong | Emphasis, start, end }
            }

            // If this node has children, search deeper
            if ('children' in child) {
              const found = findNode(child as Parent, target)
              if (found) return found
            }
          }
        }
        return null
      }

      return findNode(tree, cursorPos)
    } catch {
      return null
    }
  }

  /**
   * Expand cursor position to word boundaries if cursor is inside a word.
   * Returns original from/to if cursor is at a word boundary or there's a selection.
   */
  const expandToWord = (doc: string, from: number, to: number): { from: number; to: number } => {
    // If there's already a selection, don't expand
    if (from !== to) return { from, to }

    const pos = from

    // Check if cursor is inside a word (has word chars on both sides)
    const charBefore = pos > 0 ? doc[pos - 1] : ''
    const charAfter = pos < doc.length ? doc[pos] : ''

    // Word character pattern (letters, numbers, unicode word chars)
    const isWordChar = (c: string) => /\w/.test(c) || /[\u00C0-\u024F\u1E00-\u1EFF]/.test(c)

    // Only expand if cursor is truly inside a word (word chars on both sides)
    if (!isWordChar(charBefore) || !isWordChar(charAfter)) {
      return { from, to }
    }

    // Find word start
    let wordStart = pos
    while (wordStart > 0 && isWordChar(doc[wordStart - 1])) {
      wordStart--
    }

    // Find word end
    let wordEnd = pos
    while (wordEnd < doc.length && isWordChar(doc[wordEnd])) {
      wordEnd++
    }

    return { from: wordStart, to: wordEnd }
  }

  /**
   * Toggle bold/italic formatting. If cursor is inside the formatting, remove it.
   * Otherwise, wrap the selection with the formatting markers.
   * If cursor is inside a word with no selection, formats the entire word.
   */
  const toggleFormat = (marker: string, nodeType: 'strong' | 'emphasis') => {
    if (!editorViewRef.current || useSimpleEditor) return

    const view = editorViewRef.current
    let { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()

    // Check if cursor/selection is inside an existing format node
    const enclosing = findEnclosingFormatNode(doc, from, nodeType)

    if (enclosing) {
      // Remove the formatting by extracting the inner content
      const markerLen = marker.length
      const innerStart = enclosing.start + markerLen
      const innerEnd = enclosing.end - markerLen
      const innerContent = doc.slice(innerStart, innerEnd)

      // Calculate new cursor position after removal
      // If cursor was inside the formatted region, adjust it
      let newCursorPos = from - markerLen
      if (newCursorPos < enclosing.start) newCursorPos = enclosing.start

      view.dispatch({
        changes: { from: enclosing.start, to: enclosing.end, insert: innerContent },
        selection: { anchor: newCursorPos }
      })
    } else {
      // Expand to word if cursor is inside a word with no selection
      const expanded = expandToWord(doc, from, to)
      from = expanded.from
      to = expanded.to

      // Wrap selection with formatting
      const selectedText = doc.slice(from, to)
      const wrappedText = `${marker}${selectedText}${marker}`

      view.dispatch({
        changes: { from, to, insert: wrappedText },
        selection: { anchor: from + marker.length, head: to + marker.length }
      })
    }

    view.focus()
  }

  const insertBold = () => toggleFormat('**', 'strong')
  const insertItalic = () => toggleFormat('*', 'emphasis')
  // Set the current line's heading level. Replaces an existing heading
  // marker; same level toggles back to plain text.
  const insertHeading = (level: 1 | 2 | 3 = 2) => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const existing = line.text.match(/^(#{1,6}) /)
      const prefix = '#'.repeat(level) + ' '
      const isSame = existing?.[1].length === level

      view.dispatch({
        changes: {
          from: line.from,
          to: line.from + (existing?.[0].length ?? 0),
          insert: isSame ? '' : prefix,
        },
        selection: { anchor: line.from + (isSame ? 0 : prefix.length) }
      })
      view.focus()
    }
  }
  const toggleBlockquote = () => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const lines = []
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      lines.push(line)
      pos = line.to + 1
    }
    const allQuoted = lines.every(l => l.text.startsWith('> '))
    view.dispatch(view.state.update({
      changes: lines.map(line => allQuoted
        ? { from: line.from, to: line.from + 2, insert: '' }
        : { from: line.from, insert: '> ' }
      ),
      userEvent: 'input',
    }))
    view.focus()
  }

  // Toggle the selected lines as a bullet/numbered list (same pattern as
  // toggleBlockquote). Numbered lists renumber 1..n; toggling the other list
  // kind replaces the existing marker.
  const toggleList = (kind: 'bullet' | 'numbered') => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const lines = []
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      lines.push(line)
      pos = line.to + 1
    }
    const markerRe = kind === 'bullet' ? /^(\s*)[-*+] / : /^(\s*)\d+\. /
    const anyMarkerRe = /^(\s*)(?:[-*+]|\d+\.) /
    const allMarked = lines.every(l => markerRe.test(l.text) || l.text.trim() === '')
    view.dispatch(view.state.update({
      changes: lines.flatMap((line, i) => {
        const existing = line.text.match(anyMarkerRe)
        if (allMarked) {
          // Remove this kind's marker (keep indentation)
          const m = line.text.match(markerRe)
          if (!m) return []
          return [{ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' }]
        }
        const marker = kind === 'bullet' ? '- ' : `${i + 1}. `
        if (existing) {
          // Switch list kind in place
          return [{ from: line.from + existing[1].length, to: line.from + existing[0].length, insert: marker }]
        }
        if (line.text.trim() === '') return []
        return [{ from: line.from, insert: marker }]
      }),
      userEvent: 'input',
    }))
    view.focus()
  }

  const insertBulletList = () => toggleList('bullet')
  const insertNumberedList = () => toggleList('numbered')
  const insertLink = () => wrapSelection('[', '](url)')

  // Wrap the current line(s) in an HTML alignment block:
  //
  //   <center>
  //
  //   ## Centered heading
  //
  //   </center>
  //
  // Rewritten to <div class="es-align-center">…</div> by rehypeAlignTags.
  // Blank lines inside are required so the inner content is parsed as
  // markdown (CommonMark HTML block rules). HTML tags were chosen over
  // `:::center` because remark-directive also claimed inline `:identifier`,
  // forcing authors to escape stray colons in body text.
  // Context-aware: if the cursor is already inside a left/center/right
  // block, clicking the same alignment unwraps it; clicking a different
  // alignment rewrites both tags in place. So clicking center twice never
  // produces nested wrappers.
  const insertAlign = (alignment: 'left' | 'center' | 'right') => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const doc = view.state.doc
    const { from, to } = view.state.selection.main

    // Inside a GFM table, alignment is a per-column property of the separator
    // row (`:---` / `:---:` / `---:`) — wrap tags would break the table. Sets
    // the column(s) under the cursor/selection; same alignment again resets.
    const isTableLine = (t: string) => /^\s*\|/.test(t)
    const fromLine = doc.lineAt(from)
    if (isTableLine(fromLine.text)) {
      let first = fromLine.number
      while (first > 1 && isTableLine(doc.line(first - 1).text)) first--
      const CELL_RE = /^\s*:?-{3,}:?\s*$/
      const sepLine = first + 1 <= doc.lines ? doc.line(first + 1) : null
      const sepCells = sepLine?.text.split('|')
      if (sepLine && sepCells && sepCells.some(c => CELL_RE.test(c) && c.trim() !== '')) {
        const colAt = (lineText: string, offset: number) => {
          const pipes = (lineText.slice(0, offset).match(/\|/g) || []).length
          return Math.max(0, pipes - 1)
        }
        const toLine = doc.lineAt(to)
        const c1 = colAt(fromLine.text, from - fromLine.from)
        const c2 = isTableLine(toLine.text) ? colAt(toLine.text, to - toLine.from) : c1
        const [lo, hi] = [Math.min(c1, c2), Math.max(c1, c2)]
        const marker = alignment === 'left' ? ':---' : alignment === 'center' ? ':---:' : '---:'
        let idx = -1
        const rebuilt = sepCells.map(cell => {
          if (!(CELL_RE.test(cell) && cell.trim() !== '')) return cell
          idx++
          if (idx < lo || idx > hi) return cell
          const t = cell.trim()
          const current = t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : 'none'
          return ` ${current === alignment ? '---' : marker} `
        }).join('|')
        view.dispatch({ changes: { from: sepLine.from, to: sepLine.to, insert: rebuilt } })
        view.focus()
        return
      }
    }

    // Inline form first: <right>text…</right> on the same line(s) — the
    // form this button inserts (rehypeMarkdownChildren still parses the
    // body as markdown, so no blank lines are needed).
    const inlineStart = doc.lineAt(from)
    const inlineEnd = doc.lineAt(to)
    const segment = doc.sliceString(inlineStart.from, inlineEnd.to)
    const inlineMatch = segment.match(/^<(left|center|right)>([\s\S]*)<\/\1>\s*$/)
    if (inlineMatch) {
      const [, name, inner] = inlineMatch
      const replacement = name === alignment ? inner : `<${alignment}>${inner}</${alignment}>`
      view.dispatch({
        changes: { from: inlineStart.from, to: inlineEnd.to, insert: replacement },
        selection: { anchor: inlineStart.from + replacement.length },
      })
      view.focus()
      return
    }

    const cursorLineNum = doc.lineAt(from).number
    const OPEN_RE = /^<(left|center|right)>\s*$/
    const CLOSE_RE = /^<\/(left|center|right)>\s*$/

    // Walk up from the cursor to find an opening tag. If we hit a closing
    // tag first, the cursor isn't inside a wrapper.
    let openLineNum = -1
    let openName: string | null = null
    for (let i = cursorLineNum; i >= 1; i--) {
      const text = doc.line(i).text
      const openMatch = text.match(OPEN_RE)
      if (openMatch) {
        openLineNum = i
        openName = openMatch[1]
        break
      }
      if (i !== cursorLineNum && CLOSE_RE.test(text)) break
    }

    // If we found an opener, walk down for its matching closer.
    let closeLineNum = -1
    let closeName: string | null = null
    if (openLineNum > 0) {
      for (let i = cursorLineNum; i <= doc.lines; i++) {
        if (i === openLineNum) continue
        const text = doc.line(i).text
        if (OPEN_RE.test(text)) break // nested opener — bail
        const m = text.match(CLOSE_RE)
        if (m) {
          closeLineNum = i
          closeName = m[1]
          break
        }
      }
    }

    if (openLineNum > 0 && closeLineNum > 0 && openName && closeName) {
      const openLine = doc.line(openLineNum)
      const closeLine = doc.line(closeLineNum)
      if (openName === alignment) {
        // Same alignment → unwrap. Delete both tag lines (with their
        // newlines). The close tag might be the doc's last line, which has
        // no trailing newline — eat the leading one in that case.
        const closeIsLast = closeLine.to === doc.length
        view.dispatch({
          changes: [
            { from: openLine.from, to: Math.min(openLine.to + 1, doc.length), insert: '' },
            closeIsLast
              ? { from: Math.max(0, closeLine.from - 1), to: closeLine.to, insert: '' }
              : { from: closeLine.from, to: closeLine.to + 1, insert: '' },
          ],
        })
      } else {
        // Different alignment → rewrite both tags in place.
        view.dispatch({
          changes: [
            { from: openLine.from, to: openLine.to, insert: `<${alignment}>` },
            { from: closeLine.from, to: closeLine.to, insert: `</${alignment}>` },
          ],
        })
      }
      view.focus()
      return
    }

    // No existing wrapper → wrap the selection's full lines INLINE
    // (<right>text</right>, no extra newlines — reads better in the source
    // and rehypeMarkdownChildren parses the body as markdown either way).
    const startLine = doc.lineAt(from)
    const endLine = doc.lineAt(to)
    const inner = doc.sliceString(startLine.from, endLine.to)
    const openTag = `<${alignment}>`
    const closeTag = `</${alignment}>`
    const wrapped = `${openTag}${inner}${closeTag}`
    const anchor = inner.trim()
      ? startLine.from + wrapped.length
      : startLine.from + openTag.length // empty paragraph: cursor between the tags
    view.dispatch({
      changes: { from: startLine.from, to: endLine.to, insert: wrapped },
      selection: { anchor },
    })
    view.focus()
  }

  // Insert an Obsidian-style callout. The title MUST sit on the same line as
  // [!type] (see CLAUDE.md). We select the placeholder title so the author
  // can type over it immediately.
  const insertCallout = (type: string) => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    const insertPos = line.to
    const before = `\n\n> [!${type}] `
    const title = 'Title'
    const after = `\n> Content\n`
    const insertText = before + title + after
    view.dispatch({
      changes: { from: insertPos, insert: insertText },
      selection: { anchor: insertPos + before.length, head: insertPos + before.length + title.length },
    })
    view.focus()
  }

  // Insert math. Inline wraps the current selection in $…$; display inserts a
  // $$…$$ block on its own lines and places the cursor between the delimiters.
  const insertMathInline = () => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const selected = view.state.doc.sliceString(from, to) || 'a^2 + b^2 = c^2'
    const wrapped = `$${selected}$`
    view.dispatch({
      changes: { from, to, insert: wrapped },
      selection: { anchor: from + 1, head: from + 1 + selected.length },
    })
    view.focus()
  }
  const insertMathDisplay = () => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const pos = view.state.selection.main.head
    // Sample equation (quadratic formula) selected for overtyping — shows the
    // LaTeX idioms (frac, sqrt, subscripts) instead of an empty block.
    const sample = String.raw`x_{1,2} = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`
    const insertText = `\n$$\n${sample}\n$$\n`
    view.dispatch({
      changes: { from: pos, insert: insertText },
      selection: { anchor: pos + 4, head: pos + 4 + sample.length },
    })
    view.focus()
  }

  // Text color and highlight helpers.
  // Palette items use the *-ByName helpers (emit class-based spans that pick
  // up theme-aware CSS vars from globals.css). The "Custom color…" picker
  // falls back to the *-ByHex helpers (inline style — escape hatch for
  // colors outside the palette; not theme-aware by design).
  const insertTextColorByName = (name: string) => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const text = view.state.doc.sliceString(from, to)
    const styled = `<span class="es-color-${name}">${text}</span>`
    view.dispatch({
      changes: { from, to, insert: styled },
      selection: { anchor: from + styled.length }
    })
    view.focus()
  }

  const insertHighlightByName = (name: string) => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const text = view.state.doc.sliceString(from, to)
    const styled = `<span class="es-bg-${name}">${text}</span>`
    view.dispatch({
      changes: { from, to, insert: styled },
      selection: { anchor: from + styled.length }
    })
    view.focus()
  }

  const insertTextColorByHex = (color: string) => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const text = view.state.doc.sliceString(from, to)
    const styled = `<span style="color: ${color}">${text}</span>`
    view.dispatch({
      changes: { from, to, insert: styled },
      selection: { anchor: from + styled.length }
    })
    view.focus()
  }

  const insertHighlightByHex = (color: string) => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const { from, to } = view.state.selection.main
    const text = view.state.doc.sliceString(from, to)
    const styled = `<span style="background-color: ${color}">${text}</span>`
    view.dispatch({
      changes: { from, to, insert: styled },
      selection: { anchor: from + styled.length }
    })
    view.focus()
  }

  // Insert/replace invert attribute for images (only works when cursor is on an image)

  return (
    <div
      className={`border border-border rounded-lg bg-card h-full flex flex-col ${
        dragOver ? 'border-primary bg-primary/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* Word-style ribbon toolbar (primitives + rationale: editor-ribbon.tsx).
          Tab/group/button layout intentionally copies Word's Home/Insert/
          Layout/View so teachers can reuse their Word spatial memory. In the
          simple-textarea fallback, Home and Layout are hidden (their commands
          need the CodeMirror view). */}
      <Ribbon
        tabBarRight={onAIEdit ? (
          aiEditLocked ? (
            <button
              type="button"
              onClick={onAIEdit}
              title="AI Edit is a paid feature — click to upgrade"
              className="flex items-center gap-1.5 px-2.5 py-1 mr-1 rounded-md border border-border text-sm opacity-50 hover:bg-accent/60"
            >
              <Wand2 className="w-4 h-4" />
              AI Edit
            </button>
          ) : (
            <QuestSpotlight step="use_ai_edit" label="Try this!">
              <button
                type="button"
                onClick={onAIEdit}
                title="AI Edit"
                className="flex items-center gap-1.5 px-2.5 py-1 mr-1 rounded-md border border-border text-sm text-primary hover:bg-accent/60"
              >
                <Wand2 className="w-4 h-4" />
                AI Edit
              </button>
            </QuestSpotlight>
          )
        ) : undefined}
        tabs={[
          ...(!useSimpleEditor ? [{
            id: 'home',
            label: 'Home',
            content: (
              <>
                <RibbonGroup caption="Font">
                  <RibbonSmallStack>
                    <RibbonSmallRow>
                      <RibbonSmallButton icon={<Bold />} onClick={insertBold} title="Bold (Ctrl+B)" />
                      <RibbonSmallButton icon={<Italic />} onClick={insertItalic} title="Italic (Ctrl+I)" />
                    </RibbonSmallRow>
                    <RibbonSmallRow>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <RibbonSmallButton icon={<Palette />} title="Text Color" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {TEXT_COLOR_NAMES.map(({ name, label, cssVar }) => (
                            <DropdownMenuItem key={name} onClick={() => insertTextColorByName(name)}>
                              <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: `var(${cssVar})` }} /> {label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setShowTextColorPicker(true)}>
                            Custom color...
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <RibbonSmallButton icon={<Highlighter />} title="Highlight" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {HIGHLIGHT_NAMES.map(({ name, label, cssVar }) => (
                            <DropdownMenuItem key={name} onClick={() => insertHighlightByName(name)}>
                              <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: `var(${cssVar})` }} /> {label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setShowHighlightPicker(true)}>
                            Custom color...
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </RibbonSmallRow>
                  </RibbonSmallStack>
                </RibbonGroup>
                <RibbonGroup caption="Paragraph">
                  <RibbonSmallStack>
                    <RibbonSmallRow>
                      <RibbonSmallButton icon={<List />} onClick={insertBulletList} title="Bullet List" />
                      <RibbonSmallButton icon={<ListOrdered />} onClick={insertNumberedList} title="Numbered List" />
                      <RibbonSmallButton icon={<TextQuote />} onClick={toggleBlockquote} title="Blockquote (Ctrl+Shift+.)" />
                    </RibbonSmallRow>
                    <RibbonSmallRow>
                      <RibbonSmallButton icon={<AlignLeft />} onClick={() => insertAlign('left')} title="Align left" />
                      <RibbonSmallButton icon={<AlignCenter />} onClick={() => insertAlign('center')} title="Align center" />
                      <RibbonSmallButton icon={<AlignRight />} onClick={() => insertAlign('right')} title="Align right" />
                    </RibbonSmallRow>
                  </RibbonSmallStack>
                </RibbonGroup>
                <RibbonGroup caption="Styles">
                  <RibbonGalleryChip
                    preview={<span className="text-base font-bold leading-none">H1</span>}
                    label="Heading 1"
                    onClick={() => insertHeading(1)}
                  />
                  <RibbonGalleryChip
                    preview={<span className="text-sm font-bold leading-none">H2</span>}
                    label="Heading 2"
                    onClick={() => insertHeading(2)}
                  />
                  <RibbonGalleryChip
                    preview={<span className="text-xs font-bold leading-none">H3</span>}
                    label="Heading 3"
                    onClick={() => insertHeading(3)}
                  />
                </RibbonGroup>
              </>
            ),
          }] : []),
          {
            id: 'insert',
            label: 'Insert',
            content: (
              <>
                <RibbonGroup caption="Containers">
                  <DropdownMenu open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <RibbonBigButton icon={<Table />} label="Table" title="Insert a table (pick the size)" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <TableGridPicker onPick={(cols, rows) => { setTableMenuOpen(false); insertTable(cols, rows) }} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {!useSimpleEditor && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <RibbonBigButton icon={<MessageSquare />} label="Callout" title="Insert a callout box" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
                        {CALLOUT_GALLERY.map(({ type, label, cssVar }) => (
                          <DropdownMenuItem key={type} onClick={() => insertCallout(type)}>
                            <span className="w-3 h-3 rounded-sm mr-2" style={{ backgroundColor: `var(${cssVar})` }} /> {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </RibbonGroup>
                <RibbonGroup caption="Illustrations">
                  <RibbonBigButton icon={<ImageIcon />} label="Picture" title="Insert a picture (URL or upload)" onClick={() => setPictureDialogOpen(true)} />
                  {skriptId && (
                    <RibbonBigButton icon={<Pencil />} label="Drawing" title="Add Excalidraw Drawing" onClick={() => setExcalidrawOpen(true)} />
                  )}
                </RibbonGroup>
                <RibbonGroup caption="Media">
                  <RibbonBigButton icon={<Film />} label="Video" title="Insert a video (YouTube, uploaded, or new upload)" onClick={() => setVideoDialogOpen(true)} />
                  <RibbonBigButton icon={<Music />} label="Audio" title="Embed an audio clip" onClick={insertAudio} />
                  <RibbonBigButton icon={<FileText />} label="PDF" title="Embed a PDF (existing or upload)" onClick={() => setPdfDialogOpen(true)} />
                </RibbonGroup>
                <RibbonGroup caption="Links">
                  <RibbonBigButton icon={<Link />} label="Link" onClick={insertLink} />
                  <RibbonBigButton icon={<MousePointerClick />} label="Button" title="Call-to-action link styled as a button" onClick={insertCta} />
                </RibbonGroup>
                <RibbonGroup caption="Interactive">
                  <RibbonBigButton icon={<CircleHelp />} label="Quiz" title="Add Quiz Question" onClick={insertQuiz} />
                  <RibbonBigButton icon={<Sparkles />} label="AI Feedback" title="AI feedback on drawings, plots, and photos in this section" onClick={insertAiFeedback} />
                  <RibbonBigButton icon={<AppWindow />} label="Tabs" title="Insert tabbed sections" onClick={insertTabsContainer} />
                </RibbonGroup>
              </>
            ),
          },
          {
            id: 'maths',
            label: 'Maths',
            accent: {
              active: 'border-violet-500 text-violet-700 dark:text-violet-300',
              idle: 'text-violet-600/70 dark:text-violet-400/70 hover:text-violet-700 dark:hover:text-violet-300',
            },
            content: (
              <>
                <RibbonGroup caption="Symbols">
                  <RibbonSplitBigButton
                    icon={<Sigma />}
                    label="Equation"
                    title="Insert Math (display)"
                    onDefaultAction={insertMathDisplay}
                    menuTrigger={(bottomHalf) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>{bottomHalf}</DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[160px]">
                          <DropdownMenuItem onClick={insertMathDisplay} className="gap-2">
                            <span className="font-serif italic">∑</span>
                            <span>Display block ($$…$$)</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={insertMathInline} className="gap-2">
                            <span className="font-serif italic">x</span>
                            <span>Inline ($…$)</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  />
                </RibbonGroup>
                <RibbonGroup caption="Graphs">
                  <RibbonBigButton icon={<ChartSpline />} label="Plot" title="Insert function plot" onClick={insertPlot} />
                  <RibbonBigButton icon={<Compass />} label="GeoGebra" title="Insert GeoGebra" onClick={() => setGeogebraDialogOpen(true)} />
                </RibbonGroup>
                <RibbonGroup caption="Handwriting">
                  <RibbonBigButton icon={<SeparatorHorizontal />} label="Spacer" title="Add Spacer (graph-paper writing area)" onClick={() => insertSpacer('checkered')} />
                </RibbonGroup>
              </>
            ),
          },
          {
            id: 'chemistry',
            label: 'Chemistry',
            accent: {
              active: 'border-emerald-500 text-emerald-700 dark:text-emerald-300',
              idle: 'text-emerald-600/70 dark:text-emerald-400/70 hover:text-emerald-700 dark:hover:text-emerald-300',
            },
            content: (
              <>
                <RibbonGroup caption="Structures">
                  <RibbonBigButton icon={<Atom />} label="Molecule" title="Structural formula from a SMILES string" onClick={insertMolecule} />
                </RibbonGroup>
                <RibbonGroup caption="Equations">
                  <RibbonBigButton icon={<FlaskConical />} label="Reaction" title="Reaction equation (mhchem)" onClick={insertReaction} />
                </RibbonGroup>
                <RibbonGroup caption="Handwriting">
                  <RibbonBigButton icon={<SeparatorHorizontal />} label="Spacer" title="Add Spacer (graph-paper writing area)" onClick={() => insertSpacer('checkered')} />
                </RibbonGroup>
              </>
            ),
          },
          {
            id: 'informatics',
            label: 'Computer Science',
            accent: {
              active: 'border-cyan-500 text-cyan-700 dark:text-cyan-300',
              idle: 'text-cyan-600/70 dark:text-cyan-400/70 hover:text-cyan-700 dark:hover:text-cyan-300',
            },
            content: (
              <>
                <RibbonGroup caption="Code">
                  <RibbonSplitBigButton
                    icon={<Code />}
                    label="Code editor"
                    title="Add Code Editor (Python)"
                    onDefaultAction={insertCodeEditor}
                    menuTrigger={(bottomHalf) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>{bottomHalf}</DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[190px]">
                          <DropdownMenuItem onClick={insertCodeEditor}>Python editor</DropdownMenuItem>
                          <DropdownMenuItem onClick={insertSqlEditor}>SQL editor</DropdownMenuItem>
                          <DropdownMenuItem onClick={insertHtmlEditor}>HTML editor (live preview)</DropdownMenuItem>
                          <DropdownMenuItem onClick={insertPlainCodeBlock}>Plain code block</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  />
                  <RibbonBigButton icon={<ClipboardCheck />} label="Check" title="Auto-grading checks for a code editor (python-check)" onClick={insertPythonCheck} />
                </RibbonGroup>
                <RibbonGroup caption="Terminal">
                  <RibbonBigButton icon={<Terminal />} label="Ping" title="Interactive ping terminal" onClick={insertPing} />
                </RibbonGroup>
                <RibbonGroup caption="Extensions">
                  <RibbonBigButton icon={<Puzzle />} label="Plugin" title="Insert Plugin" onClick={() => setPluginPickerOpen(true)} />
                </RibbonGroup>
              </>
            ),
          },
          ...(!useSimpleEditor ? [{
            id: 'layout',
            label: 'Layout',
            content: (
              <>
                <RibbonGroup caption="Arrange">
                  <RibbonBigButton icon={<Columns3 />} label="Columns" title="Side-by-side layout (flex)" onClick={insertFlex} />
                  <RibbonBigButton icon={<MoveHorizontal />} label="Full width" title="Edge-to-edge container" onClick={insertFullwidth} />
                  <RibbonBigButton icon={<Pin />} label="Pin to margin" title="Pin content to the margin while scrolling (stickme)" onClick={insertStickme} />
                  <RibbonBigButton icon={<SeparatorHorizontal />} label="Spacer" title="Add a blank spacer (vertical whitespace)" onClick={() => insertSpacer('blank')} />
                </RibbonGroup>
              </>
            ),
          }] : []),
          {
            id: 'view',
            label: 'View',
            content: (
              <>
                <RibbonGroup caption="Views">
                  <RibbonBigButton
                    icon={<FilePen />}
                    label="Editor"
                    title="Editor only"
                    active={showEditor && !showPreview}
                    onClick={() => setEditorWidth(100)}
                  />
                  <RibbonBigButton
                    icon={<Columns2 />}
                    label="Split"
                    title="Editor and preview side by side"
                    active={showEditor && showPreview}
                    onClick={() => setEditorWidth(50)}
                  />
                  <RibbonBigButton
                    icon={<Eye />}
                    label="Preview"
                    title="Preview only"
                    active={!showEditor}
                    onClick={() => setEditorWidth(0)}
                  />
                </RibbonGroup>
                <RibbonGroup caption="Zoom">
                  <RibbonSmallRow>
                    <RibbonSmallButton icon={<Minus />} onClick={() => setEditorFontSize(Math.max(10, editorFontSize - 1))} title="Decrease editor font size" />
                    <span className="text-xs text-muted-foreground w-6 text-center tabular-nums">{editorFontSize}</span>
                    <RibbonSmallButton icon={<Plus />} onClick={() => setEditorFontSize(Math.min(24, editorFontSize + 1))} title="Increase editor font size" />
                  </RibbonSmallRow>
                </RibbonGroup>
              </>
            ),
          },
        ]}
      />

      {/* Editor and Preview */}
      <div ref={containerRef} className="flex flex-1 min-h-[400px] relative overflow-hidden">
        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded">
            <div className="text-center">
              <div className="text-primary text-lg font-semibold">
                {dragOver === 'docx' ? 'Drop DOCX to extract and insert content' :
                 dragOver === 'pdf' ? 'Drop PDF to upload and embed' :
                 'Drop files here to insert'}
              </div>
              {dragOver === 'generic' && (
                <div className="text-primary/80 text-sm">
                  Images, documents, videos, and more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Editor */}
        <div
          className="relative"
          style={{
            width: showEditor ? (showPreview ? `${editorWidth}%` : '100%') : '0',
            display: showEditor ? 'block' : 'none'
          }}
        >
          {useSimpleEditor ? (
            <textarea
              value={textareaContent}
              onChange={handleTextareaChange}
              readOnly={isReadOnly}
              className="w-full h-full p-3 border-0 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-hidden"
              placeholder="Start typing your markdown here..."
              style={{ minHeight: '100%' }}
            />
          ) : (
            <div ref={editorRef} className="h-full" />
          )}

          {/* Editor-only display size — doesn't affect page content, so it
              floats over the editor pane rather than living in the shared
              toolbar. */}
          <div className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-md border bg-background/90 backdrop-blur-xs shadow-xs p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const newSize = Math.max(10, editorFontSize - 1)
                setEditorFontSize(newSize)
                localStorage.setItem('eduskript:editor-font-size', String(newSize))
              }}
              className="w-6 h-6 p-0"
              title="Decrease font size"
            >
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-xs text-muted-foreground w-6 text-center tabular-nums">{editorFontSize}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const newSize = Math.min(24, editorFontSize + 1)
                setEditorFontSize(newSize)
                localStorage.setItem('eduskript:editor-font-size', String(newSize))
              }}
              className="w-6 h-6 p-0"
              title="Increase font size"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Draggable Splitter - wider touch target on mobile */}
        {showEditor && showPreview && (
          <div
            onMouseDown={handleSplitterMouseDown}
            onTouchStart={handleSplitterTouchStart}
            className={`w-2 sm:w-2 touch:w-4 bg-border hover:bg-primary/20 cursor-col-resize shrink-0 transition-colors relative flex items-center justify-center touch-none ${
              isDragging ? 'bg-primary/30' : ''
            }`}
            style={{ minWidth: '8px' }}
          >
            {/* Drag indicator */}
            <div className="text-muted-foreground/40 text-xs select-none pointer-events-none">
              ⋮
            </div>
            {/* Extended touch target (invisible but increases hit area) */}
            <div className="absolute inset-y-0 -left-2 -right-2 md:hidden" />
          </div>
        )}

        {/* Preview */}
        {showPreview && (
          <div ref={previewRef} onClick={handlePreviewClick} style={{ width: showEditor ? `${100 - editorWidth}%` : '100%' }} className="overflow-auto bg-card" id="markdown-preview-scroll-container" data-typography="modern">
            <div className="p-4">
              <InteractivePreview
                markdown={useSimpleEditor ? textareaContent : editorContent}
                onContentChange={onChange}
                fileList={fileList}
                videoList={videoList}
                pageId={pageId}
                skriptId={skriptId}
                onExcalidrawEdit={onExcalidrawEditProp ?? handleExcalidrawEdit}
              />
            </div>
          </div>
        )}
      </div>

      {/* Excalidraw Modal */}
      {skriptId && (
        <ExcalidrawEditor
          open={excalidrawOpen}
          onClose={() => {
            setExcalidrawOpen(false)
            setExcalidrawInitialData(undefined)
            setIsEditingExistingExcalidraw(false) // Reset flag when closing
          }}
          onSave={handleExcalidrawSave}
          skriptId={skriptId}
          initialData={excalidrawInitialData}
          suggestedName={isEditingExistingExcalidraw ? undefined : nextExcalidrawName(fileList)}
        />
      )}
      {/* Custom Text Color Picker */}
      <Popover open={showTextColorPicker} onOpenChange={setShowTextColorPicker}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Sketch
            color="#000000"
            onChange={(color) => {
              insertTextColorByHex(color.hex)
              setShowTextColorPicker(false)
            }}
          />
        </PopoverContent>
      </Popover>

      {/* Custom Highlight Picker */}
      <Popover open={showHighlightPicker} onOpenChange={setShowHighlightPicker}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Sketch
            color="#fef08a"
            onChange={(color) => {
              insertHighlightByHex(color.hex)
              setShowHighlightPicker(false)
            }}
          />
        </PopoverContent>
      </Popover>

      {/* Plugin Picker */}
      <PluginPicker
        open={pluginPickerOpen}
        onOpenChange={setPluginPickerOpen}
        onSelect={insertPlugin}
        userId={session?.user?.id}
      />

      <GeogebraDialog
        open={geogebraDialogOpen}
        onOpenChange={setGeogebraDialogOpen}
        onInsert={insertGeogebra}
      />

      <PictureDialog
        open={pictureDialogOpen}
        onOpenChange={setPictureDialogOpen}
        skriptId={skriptId}
        onInsert={(md) => insertBlockTemplate(`${md}\n`)}
      />

      <VideoPickDialog
        open={videoDialogOpen}
        onOpenChange={setVideoDialogOpen}
        skriptId={skriptId}
        videos={videoList ?? []}
        onInsert={(md) => insertBlockTemplate(`${md}\n`)}
        onUploaded={onFileUpload}
      />

      <PdfPickDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        skriptId={skriptId}
        files={(fileList ?? []).filter((f): f is { id: string; name: string } => Boolean(f.name))}
        onInsert={(md) => insertBlockTemplate(`${md}\n`)}
        onUploaded={onFileUpload}
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

export default CodeMirrorEditor
