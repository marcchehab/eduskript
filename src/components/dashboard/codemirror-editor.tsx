'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Eye, EyeOff, Pencil, Code, Bold, Italic, Heading, Heading1, Heading2, Heading3, List, ListOrdered, Link, Palette, Highlighter, Circle, Wand2, ChevronDown, FilePen, Minus, Plus, CircleHelp, TextQuote, Puzzle } from 'lucide-react'
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
import { InteractivePreview } from './interactive-preview'
import { autocompletion } from '@codemirror/autocomplete'
import { createMarkdownCompletions } from './markdown-completions'
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
  onAIEdit
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
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Removed previewContent state - React renderer handles markdown directly
  const [isMounted, setIsMounted] = useState(false)
  const [useSimpleEditor, setUseSimpleEditor] = useState(false)
  const [textareaContent, setTextareaContent] = useState(content || '')
  const [dragOver, setDragOver] = useState<false | 'generic' | 'docx' | 'pdf'>(false)
  const [excalidrawOpen, setExcalidrawOpen] = useState(false)
  const [pluginPickerOpen, setPluginPickerOpen] = useState(false)
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
      // Image - use regular markdown syntax with just filename for path resolution
      const altText = fileName.replace(/\.[^/.]+$/, '')
      insertText = `![${altText}](${fileName})`
    } else if (extension === 'excalidraw') {
      // Excalidraw drawing - use image syntax with just filename
      insertText = `![](${fileName})`
    } else if (['mp4', 'avi', 'mov', 'wmv'].includes(extension || '')) {
      // Video - use full URL for non-image files
      insertText = `<video controls>\n  <source src="${file.url || fileName}" type="video/${extension}">\n  Your browser does not support the video tag.\n</video>`
    } else if (['mp3', 'wav', 'ogg'].includes(extension || '')) {
      // Audio - use full URL for non-image files
      insertText = `<audio controls>\n  <source src="${file.url || fileName}" type="audio/${extension}">\n  Your browser does not support the audio tag.\n</audio>`
    } else {
      // Generic file/download link - use full URL for non-image files
      insertText = `[${fileName}](${file.url || fileName})`
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
              override: [createMarkdownCompletions(() => fileListRef.current || [])],
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
          firstElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
    const codeEditorTemplate = '```python editor\n# Write your Python code here\nprint("Hello, World!")\n```\n'

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
    const quizTemplate = `<Question id="${generateId()}">\n  <Option correct="true">Correct answer</Option>\n  <Option>Wrong answer</Option>\n</Question>\n`

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

    // Only insert reference for NEW drawings, not when editing existing ones
    if (!isEditingExistingExcalidraw) {
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
  const insertHeading = (level: 1 | 2 | 3 = 2) => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const lineStart = line.from
      const prefix = '#'.repeat(level) + ' '

      view.dispatch({
        changes: { from: lineStart, insert: prefix },
        selection: { anchor: lineStart + prefix.length }
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

  const insertBulletList = () => insertAtCursor('\n- ')
  const insertNumberedList = () => insertAtCursor('\n1. ')
  const insertLink = () => wrapSelection('[', '](url)')

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
  const insertInvert = (mode: 'dark' | 'light' | 'always' = 'dark') => {
    if (!editorViewRef.current || useSimpleEditor) return
    const view = editorViewRef.current
    const pos = view.state.selection.main.head
    const doc = view.state.doc.toString()

    // Find if cursor is inside or touching an image tag
    // Pattern: ![alt](src){optional attributes}
    const imageRegex = /!\[[^\]]*\]\([^)]+\)(\{[^}]*\})?/g
    let match
    let foundImage: { start: number; end: number; hasAttrs: boolean; attrsStart: number; attrsEnd: number; attrs: string } | null = null

    while ((match = imageRegex.exec(doc)) !== null) {
      const start = match.index
      const end = start + match[0].length

      // Check if cursor is inside or touching this image (within 1 char)
      if (pos >= start && pos <= end + 1) {
        const hasAttrs = !!match[1]
        foundImage = {
          start,
          end,
          hasAttrs,
          attrsStart: hasAttrs ? end - match[1].length : end,
          attrsEnd: end,
          attrs: hasAttrs ? match[1].slice(1, -1) : '' // Remove { and }
        }
        break
      }
    }

    // If cursor is not on an image, do nothing
    if (!foundImage) return

    const invertValue = mode === 'dark' ? 'invert' : `invert=${mode}`

    if (foundImage.hasAttrs) {
      // Update existing attributes - replace or add invert
      let newAttrs = foundImage.attrs
        .split(';')
        .map(a => a.trim())
        .filter(a => !a.startsWith('invert')) // Remove existing invert
        .filter(a => a) // Remove empty

      newAttrs.unshift(invertValue) // Add new invert at start
      const newAttrsStr = `{${newAttrs.join(';')}}`

      view.dispatch({
        changes: { from: foundImage.attrsStart, to: foundImage.attrsEnd, insert: newAttrsStr },
        selection: { anchor: foundImage.attrsStart + newAttrsStr.length }
      })
    } else {
      // Add new attributes block
      const newAttrsStr = `{${invertValue}}`
      view.dispatch({
        changes: { from: foundImage.end, insert: newAttrsStr },
        selection: { anchor: foundImage.end + newAttrsStr.length }
      })
    }
    view.focus()
  }

  return (
    <div
      className={`border border-border rounded-lg bg-card h-full flex flex-col ${
        dragOver ? 'border-primary bg-primary/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="border-b border-border p-2">
        <div className="flex flex-wrap items-center gap-1 gap-y-2">
          {/* AI Edit button - leftmost */}
          {onAIEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAIEdit}
              title="AI Edit"
              className="w-8 h-8 p-0 border rounded-md"
            >
              <Wand2 className="w-4 h-4" />
            </Button>
          )}
          {/* Formatting buttons */}
          {!useSimpleEditor && (
            <>
              <div className="h-4 w-px bg-border mx-1" />
              {/* Text formatting group */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertBold}
                  title="Bold (Ctrl+B)"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <Bold className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertItalic}
                  title="Italic (Ctrl+I)"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <Italic className="w-4 h-4" />
                </Button>
                <DropdownMenu>
                  <div className="flex items-center border rounded-md h-8">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertHeading(2)}
                      title="Heading 2"
                      className="w-8 h-8 p-0 rounded-r-none border-0"
                    >
                      <Heading className="w-4 h-4" />
                    </Button>
                    <div className="h-4 w-px bg-border" />
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-5 h-8 p-0 rounded-l-none border-0"
                        title="Heading options"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                  </div>
                  <DropdownMenuContent align="start" className="min-w-[120px]">
                    <DropdownMenuItem onClick={() => insertHeading(1)} className="gap-2">
                      <Heading1 className="w-4 h-4" />
                      <span>Heading 1</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHeading(2)} className="gap-2">
                      <Heading2 className="w-4 h-4" />
                      <span>Heading 2</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHeading(3)} className="gap-2">
                      <Heading3 className="w-4 h-4" />
                      <span>Heading 3</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {/* Structure group */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertBulletList}
                  title="Bullet List"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertNumberedList}
                  title="Numbered List"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <ListOrdered className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertLink}
                  title="Link"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <Link className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleBlockquote}
                  title="Blockquote (Ctrl+Shift+.)"
                  className="w-8 h-8 p-0 border rounded-md"
                >
                  <TextQuote className="w-4 h-4" />
                </Button>
              </div>
              <div className="h-4 w-px bg-border mx-1" />
              {/* Colors group */}
              <div className="flex items-center gap-1">
                {/* Text Color Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Text Color"
                      className="w-8 h-8 p-0 border rounded-md"
                    >
                      <Palette className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* Swatch reads the same CSS var the rendered class uses,
                        so the picker preview matches what authors will see in
                        the current theme. */}
                    <DropdownMenuItem onClick={() => insertTextColorByName('red')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-red)' }} /> Red
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('orange')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-orange)' }} /> Orange
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('lightgreen')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-lightgreen)' }} /> Light green
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('green')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-green)' }} /> Green
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('cyan')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-cyan)' }} /> Cyan
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('lightblue')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-lightblue)' }} /> Light blue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('blue')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-blue)' }} /> Blue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('violet')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-violet)' }} /> Violet
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertTextColorByName('purple')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-color-purple)' }} /> Purple
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowTextColorPicker(true)}>
                      Custom color...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Highlight Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Highlight"
                      className="w-8 h-8 p-0 border rounded-md"
                    >
                      <Highlighter className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => insertHighlightByName('yellow')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-yellow)' }} /> Yellow
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('green')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-green)' }} /> Green
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('blue')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-blue)' }} /> Blue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('pink')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-pink)' }} /> Pink
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('orange')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-orange)' }} /> Orange
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('red')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-red)' }} /> Red
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertHighlightByName('purple')}>
                      <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: 'var(--es-bg-purple)' }} /> Purple
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowHighlightPicker(true)}>
                      Custom color...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Invert Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Invert image colors (for dark mode diagrams)"
                      className="w-8 h-8 p-0 border rounded-md"
                    >
                      <span className="w-4 h-4 rounded-full border border-current overflow-hidden flex">
                        <span className="w-1/2 bg-current" />
                        <span className="w-1/2" />
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => insertInvert('dark')}>
                      <span className="w-4 h-4 rounded-full mr-2 border overflow-hidden flex">
                        <span className="w-1/2 bg-black" />
                        <span className="w-1/2 bg-white" />
                      </span>
                      Invert in dark mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertInvert('light')}>
                      <span className="w-4 h-4 rounded-full mr-2 border overflow-hidden flex">
                        <span className="w-1/2 bg-white" />
                        <span className="w-1/2 bg-black" />
                      </span>
                      Invert in light mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertInvert('always')}>
                      <span className="w-4 h-4 rounded-full mr-2 border bg-gray-400" />
                      Always invert
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="h-4 w-px bg-border mx-1" />
            </>
          )}

          {/* Insert group */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={insertCodeEditor}
              className="w-8 h-8 p-0 border rounded-md"
              title="Add Code Editor"
            >
              <Code className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={insertQuiz}
              className="w-8 h-8 p-0 border rounded-md"
              title="Add Quiz Question"
            >
              <CircleHelp className="w-4 h-4" />
            </Button>
            {skriptId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExcalidrawOpen(true)}
                className="w-8 h-8 p-0 border rounded-md"
                title="Add Excalidraw Drawing"
              >
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPluginPickerOpen(true)}
              className="w-8 h-8 p-0 border rounded-md"
              title="Insert Plugin"
            >
              <Puzzle className="w-4 h-4" />
            </Button>
          </div>

          {/* Font size controls */}
          <div className="h-4 w-px bg-border mx-1" />
          <div className="flex items-center gap-0.5">
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

          {/* Show collapsed panel buttons */}
          {(!showEditor || !showPreview) && (
            <>
              <div className="h-4 w-px bg-border mx-1" />
              <div className="flex items-center gap-1">
                {!showEditor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditorWidth(50)}
                    className="w-8 h-8 p-0 border rounded-md text-red-500 hover:text-foreground hover:!bg-blue-100 dark:hover:!bg-blue-900"
                    title="Show Editor"
                  >
                    <FilePen className="w-4 h-4" />
                  </Button>
                )}
                {!showPreview && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditorWidth(50)}
                    className="w-8 h-8 p-0 border rounded-md text-red-500 hover:text-foreground hover:!bg-blue-100 dark:hover:!bg-blue-900"
                    title="Show Preview"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

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
              className="w-full h-full p-3 border-0 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-none"
              placeholder="Start typing your markdown here..."
              style={{ minHeight: '100%' }}
            />
          ) : (
            <div ref={editorRef} className="h-full" />
          )}
        </div>

        {/* Draggable Splitter - wider touch target on mobile */}
        {showEditor && showPreview && (
          <div
            onMouseDown={handleSplitterMouseDown}
            onTouchStart={handleSplitterTouchStart}
            className={`w-2 sm:w-2 touch:w-4 bg-border hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-colors relative flex items-center justify-center touch-none ${
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
