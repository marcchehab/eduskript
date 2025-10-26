'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { processMarkdown } from '@/lib/markdown'
import { Button } from '@/components/ui/button'
import { Save, Eye, EyeOff, Pencil } from 'lucide-react'
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
  onSave,
  skriptId,
  domain,
  isReadOnly = false,
  fileList,
  fileListLoading = false,
  onFileUpload
}: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const [showPreview, setShowPreview] = useState(true)
  const [previewContent, setPreviewContent] = useState('')
  const [isMounted, setIsMounted] = useState(false)
  const [useSimpleEditor, setUseSimpleEditor] = useState(false)
  const [textareaContent, setTextareaContent] = useState(content || '')
  const [dragOver, setDragOver] = useState(false)
  const [excalidrawOpen, setExcalidrawOpen] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === 'dark'

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
          }
        }
      } catch (error) {
        console.error('Error uploading dropped files:', error)
      }
    }
  }

  // Insert file at specific position (or cursor if no position provided)
  const insertFileAtPosition = (file: { id: string; name: string; url?: string; isDirectory?: boolean }, position?: number | null) => {
    if (file.isDirectory) return // Don't insert directories
    
    let insertText = ''
    
    // Determine the type of insert based on file extension
    const extension = file.name.split('.').pop()?.toLowerCase()
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')) {
      // Image - use regular markdown syntax with just filename for path resolution
      const altText = file.name.replace(/\.[^/.]+$/, '')
      insertText = `![${altText}](${file.name})`
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

  // Fallback for content
  const editorContent = content || ''

  // Ensure component is mounted
  useEffect(() => {
    setIsMounted(true)
    console.log('CodeMirrorEditor mounting...')
  }, [])

  // Process markdown for preview
  useEffect(() => {
    if (!isMounted || fileListLoading) return

    const updatePreview = async () => {
      try {
        const processed = await processMarkdown(
          useSimpleEditor ? textareaContent : editorContent,
          {
            domain,
            skriptId,
            fileList: fileList || [],
            theme: isDark ? 'dark' : 'light'
          }
        )
        setPreviewContent(processed.content)
      } catch (error) {
        console.error('Error processing markdown:', error)
        setPreviewContent('<p>Error processing markdown</p>')
      }
    }

    updatePreview()
  }, [editorContent, textareaContent, useSimpleEditor, isMounted, domain, skriptId, fileList, fileListLoading, isDark])
  useEffect(() => {
    if (!isMounted || !editorRef.current) return

    // Set a hard timeout to fallback to simple editor
    const fallbackTimeout = setTimeout(() => {
      console.log('Forcing fallback to simple editor due to timeout')
      setUseSimpleEditor(true)
    }, 5000) // Increased timeout to 5 seconds

    const initializeCodeMirror = async () => {
      try {
        // Clean up existing editor first
        if (editorViewRef.current) {
          editorViewRef.current.destroy()
          editorViewRef.current = null
        }
        
        console.log('Attempting to load CodeMirror...')
        
        // Try to import CodeMirror modules one by one with better error handling
        console.log('Loading codemirror (basic setup)...')
        const { basicSetup } = await import('codemirror')
        
        console.log('Loading @codemirror/view...')
        const { EditorView } = await import('@codemirror/view')
          
        console.log('Loading @codemirror/state...')
        const { EditorState } = await import('@codemirror/state')
        
        console.log('Loading @codemirror/lang-markdown...')
        const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown')
        const { LanguageDescription } = await import('@codemirror/language')
        
        console.log('Loading language support...')
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
        console.log('Loading VS Code themes...')
        const { vsCodeLight } = await import('@fsegurai/codemirror-theme-vscode-light')
        const { vsCodeDark } = await import('@fsegurai/codemirror-theme-vscode-dark')
        
        console.log('All CodeMirror modules loaded successfully')

        console.log('Creating editor state...')
        
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
            markdownExtension,
            ...(isDark ? [vsCodeDark] : [vsCodeLight]),
            EditorView.updateListener.of((update: ViewUpdate) => {
              if (update.docChanged) {
                const newContent = update.state.doc.toString()
                onChange(newContent)
              }
            }),
            EditorView.theme({
              '&': {
                height: '100%',
                backgroundColor: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
              },
              '.cm-content': {
                padding: '12px',
                fontSize: '14px',
                lineHeight: '1.5',
                backgroundColor: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
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
                backgroundColor: 'hsl(var(--card))',
                minHeight: '100%',
                overflowX: 'hidden', // Prevent horizontal overflow
              },
              '.cm-line': {
                wordBreak: 'break-word', // Break long words
              },
              // Fix with specific selector that causes transparent selection background issues
              '&.cm-focused .cm-line ::selection': {
                backgroundColor: isDark ? 'rgba(59, 130, 246, 0.3) !important' : 'rgba(37, 99, 235, 0.3) !important',
              },
              '&.cm-focused .cm-line::selection': {
                backgroundColor: isDark ? 'rgba(59, 130, 246, 0.3) !important' : 'rgba(37, 99, 235, 0.3) !important',
              },
            }),
            EditorView.lineWrapping, // Add line wrapping extension
          ],
        })

        console.log('Creating editor view...')
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
        console.log('CodeMirror initialized successfully')

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

  // Handle textarea change for simple editor
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setTextareaContent(newContent)
    onChange(newContent)
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
      const insertText = `![[${name}.excalidraw]]\n`

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2"
          >
            {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showPreview ? 'Hide Preview' : 'Show Preview'}
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
              Drawing
            </Button>
          )}
          <span className="text-xs text-primary">
            {useSimpleEditor ? 'Simple Editor (CodeMirror Failed)' : 'CodeMirror Loaded'}
          </span>
        </div>

        {onSave && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save
          </Button>
        )}
      </div>

      {/* Editor and Preview */}
      <div className="flex h-[600px] min-h-[400px] relative">
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
        <div className={`${showPreview ? 'w-1/2' : 'w-full'} ${showPreview ? 'border-r border-border' : ''}`}>
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

        {/* Preview */}
        {showPreview && (
          <div className="w-1/2 overflow-auto bg-card">
            <div className="p-4">
              <InteractivePreview
                html={previewContent}
                onContentChange={onChange}
                originalMarkdown={useSimpleEditor ? textareaContent : editorContent}
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
