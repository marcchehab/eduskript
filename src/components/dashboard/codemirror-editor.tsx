'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Pencil, Code, Bold, Italic, Heading, List, ListOrdered, Link } from 'lucide-react'
import { ExcalidrawEditor } from './excalidraw-editor'
import { InteractivePreview } from './interactive-preview'
import type { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

interface CodeMirrorEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  skriptId?: string
  domain?: string
  isReadOnly?: boolean
  fileList?: Array<{id: string, name: string, url?: string, isDirectory?: boolean}>
  fileListLoading?: boolean
  onFileUpload?: () => void
}

const CodeMirrorEditor = function CodeMirrorEditor({
  content,
  onChange,
  skriptId,
  isReadOnly = false,
  fileList,
  onFileUpload
}: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const previewRef = useRef<HTMLDivElement>(null)
  const [editorWidth, setEditorWidth] = useState(50) // Percentage
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Removed previewContent state - React renderer handles markdown directly
  const [isMounted, setIsMounted] = useState(false)
  const [useSimpleEditor, setUseSimpleEditor] = useState(false)
  const [textareaContent, setTextareaContent] = useState(content || '')
  const [dragOver, setDragOver] = useState(false)
  const [excalidrawOpen, setExcalidrawOpen] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  // Track current heading/paragraph
  const [currentHeading, setCurrentHeading] = useState<string>('')
  const [cursorLine, setCursorLine] = useState<number>(1)
  const [totalLines, setTotalLines] = useState<number>(1)

  // Scroll sync
  const scrollSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isScrollingSyncRef = useRef(false)

  // Calculate visibility based on width
  const MIN_VISIBLE_WIDTH = 100 // pixels
  const showEditor = containerRef.current ? (editorWidth / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const showPreview = containerRef.current ? ((100 - editorWidth) / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true

  // Update the onChange ref when it changes
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Handle file drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
    
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
        insertFileAtPosition(file, dropPosition)
        return
      } catch (error) {
        console.error('Error parsing file data:', error)
      }
    }

    // Handle computer file drops
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && skriptId) {
      try {
        for (const file of files) {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('uploadType', 'skript')
          formData.append('skriptId', skriptId)

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })

          if (response.ok) {
            const uploadedFile = await response.json()
            insertFileAtPosition(uploadedFile, dropPosition)
            // Refresh file list after successful upload
            if (onFileUpload) {
              onFileUpload()
            }
          } else {
            // Handle upload error
            try {
              const errorData = await response.json()
              const errorMessage = errorData.error || 'Upload failed'
              alert(`Failed to upload file: ${errorMessage}`)
            } catch {
              alert(`Failed to upload file (status ${response.status})`)
            }
          }
        }
      } catch (error) {
        console.error('Error uploading dropped files:', error)
        alert('Failed to upload file. Please try again.')
      }
    }
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
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
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

  // Handle splitter drag
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Clamp between 5% and 95%
      setEditorWidth(Math.max(5, Math.min(95, newEditorWidth)))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
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
            keymap.of([indentWithTab]), // Enable Tab/Shift+Tab for indentation
            markdownExtension,
            ...(isDark ? [vsCodeDark] : [vsCodeLight]),
            EditorView.updateListener.of((update: ViewUpdate) => {
              if (update.docChanged) {
                const newContent = update.state.doc.toString()
                onChange(newContent)
              }

              // Track cursor position and current heading
              if (update.selectionSet || update.docChanged) {
                const { state } = update
                const cursorPos = state.selection.main.head
                const lineNum = state.doc.lineAt(cursorPos).number
                const numLines = state.doc.lines
                setCursorLine(lineNum)
                setTotalLines(numLines)

                // Find the current heading by searching backwards from cursor
                const text = state.doc.toString()
                const lines = text.split('\n')
                let heading = ''

                for (let i = lineNum - 1; i >= 0; i--) {
                  const line = lines[i]
                  const match = line.match(/^(#{1,6})\s+(.+)/)
                  if (match) {
                    heading = match[2] // Extract heading text without the #
                    break
                  }
                }

                setCurrentHeading(heading || 'Top of document')

                // Highlight corresponding element in preview
                if (previewRef.current) {
                  // Calculate rough position percentage
                  const percentage = lineNum / Math.max(numLines, 1)

                  // Find all block elements in preview
                  const blocks = previewRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6, p, pre, ul, ol, blockquote, table, div.code-editor')

                  // Remove previous highlights
                  blocks.forEach(block => {
                    block.classList.remove('editor-current-paragraph')
                  })

                  // Find and highlight the element at this position
                  const targetIndex = Math.floor(percentage * blocks.length)
                  if (blocks[targetIndex]) {
                    blocks[targetIndex].classList.add('editor-current-paragraph')
                  }
                }
              }
            }),
            EditorView.theme({
              '&': {
                height: '100%',
              },
              '.cm-content': {
                padding: '12px',
                fontSize: '14px',
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
                overflowX: 'hidden', // Prevent horizontal overflow
              },
              '.cm-line': {
                wordBreak: 'break-word', // Break long words
              },
            }),
            EditorView.lineWrapping, // Add line wrapping extension
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

  // Update editor content when prop changes
  useEffect(() => {
    if (editorViewRef.current && editorContent !== editorViewRef.current.state.doc.toString()) {
      try {
        const transaction = editorViewRef.current.state.update({
          changes: {
            from: 0,
            to: editorViewRef.current.state.doc.length,
            insert: editorContent,
          },
        })
        editorViewRef.current.dispatch(transaction)
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

  // Handle textarea change for simple editor
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setTextareaContent(newContent)
    onChange(newContent)
  }

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

  // Handle Excalidraw save
  const handleExcalidrawSave = async (name: string, excalidrawData: string, lightSvg: string, darkSvg: string) => {
    if (!skriptId) {
      alert('Skript ID is required to save drawings')
      return
    }

    try {
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
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save drawing')
      }

      // Insert reference to the drawing in the editor
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

      // Refresh file list
      if (onFileUpload) {
        onFileUpload()
      }

      alert('Drawing saved successfully!')
    } catch (error) {
      console.error('Error saving drawing:', error)
      alert('Failed to save drawing. Please try again.')
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

  const insertBold = () => wrapSelection('**')
  const insertItalic = () => wrapSelection('*')
  const insertHeading = () => {
    if (editorViewRef.current && !useSimpleEditor) {
      const view = editorViewRef.current
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const lineStart = line.from

      view.dispatch({
        changes: { from: lineStart, insert: '## ' },
        selection: { anchor: lineStart + 3 }
      })
      view.focus()
    }
  }
  const insertBulletList = () => insertAtCursor('\n- ')
  const insertNumberedList = () => insertAtCursor('\n1. ')
  const insertLink = () => wrapSelection('[', '](url)')

  return (
    <div 
      className={`border border-border rounded-lg bg-card ${
        dragOver ? 'border-primary bg-primary/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="border-b border-border p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Formatting buttons */}
          {!useSimpleEditor && (
            <>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                onClick={insertBold}
                title="Bold (Ctrl+B)"
                className="px-2"
              >
                <Bold className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={insertItalic}
                title="Italic (Ctrl+I)"
                className="px-2"
              >
                <Italic className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={insertHeading}
                title="Heading"
                className="px-2"
              >
                <Heading className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={insertBulletList}
                title="Bullet List"
                className="px-2"
              >
                <List className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={insertNumberedList}
                title="Numbered List"
                className="px-2"
              >
                <ListOrdered className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={insertLink}
                title="Link"
                className="px-2"
              >
                <Link className="w-4 h-4" />
              </Button>
              <div className="h-4 w-px bg-border" />
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={insertCodeEditor}
            className="flex items-center gap-2"
            title="Insert Python Code Editor"
          >
            <Code className="w-4 h-4" />
            Add Code Editor
          </Button>
          {skriptId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExcalidrawOpen(true)}
              className="flex items-center gap-2"
              title="Create Drawing"
            >
              <Pencil className="w-4 h-4" />
              Add Drawing
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!showEditor && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditorWidth(50)}
              className="flex items-center gap-2"
            >
              <Pencil className="w-4 h-4" />
              Show Editor
            </Button>
          )}
          {!showPreview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditorWidth(50)}
              className="flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              Show Preview
            </Button>
          )}
        </div>
      </div>

      {/* Editor and Preview */}
      <div ref={containerRef} className="flex h-[600px] min-h-[400px] relative">
        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded">
            <div className="text-center">
              <div className="text-primary text-lg font-semibold">
                Drop files here to insert
              </div>
              <div className="text-primary/80 text-sm">
                Images, documents, videos, and more
              </div>
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

        {/* Draggable Splitter */}
        {showEditor && showPreview && (
          <div
            onMouseDown={handleSplitterMouseDown}
            className={`w-2 bg-border hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-colors relative flex items-center justify-center ${
              isDragging ? 'bg-primary/30' : ''
            }`}
          >
            {/* Drag indicator */}
            <div className="text-muted-foreground/40 text-xs select-none pointer-events-none">
              ⋮
            </div>
          </div>
        )}

        {/* Preview */}
        {showPreview && (
          <div ref={previewRef} style={{ width: showEditor ? `${100 - editorWidth}%` : '100%' }} className="overflow-auto bg-card" id="markdown-preview-scroll-container">
            <div className="p-4">
              <InteractivePreview
                markdown={useSimpleEditor ? textareaContent : editorContent}
                onContentChange={onChange}
                fileList={fileList}
                theme={isDark ? 'dark' : 'light'}
              />
            </div>
          </div>
        )}
      </div>

      {/* Excalidraw Modal */}
      {skriptId && (
        <ExcalidrawEditor
          open={excalidrawOpen}
          onClose={() => setExcalidrawOpen(false)}
          onSave={handleExcalidrawSave}
          skriptId={skriptId}
        />
      )}
    </div>
  )
}

export default CodeMirrorEditor
