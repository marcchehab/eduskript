'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { processMarkdown } from '@/lib/markdown'
import { Button } from '@/components/ui/button'
import { Save, Eye, EyeOff } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

interface CodeMirrorEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  onFileInsert?: (file: {
    filename: string
    url: string
    uploadType: string
  }) => void
  chapterId?: string
  domain?: string
  isReadOnly?: boolean
}

export default function CodeMirrorEditor({ 
  content, 
  onChange, 
  onSave,
  onFileInsert,
  chapterId,
  domain,
  isReadOnly = false 
}: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [previewContent, setPreviewContent] = useState('')
  const [isMounted, setIsMounted] = useState(false)
  const [useSimpleEditor, setUseSimpleEditor] = useState(false)
  const [textareaContent, setTextareaContent] = useState(content || '')
  const [dragOver, setDragOver] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  // Handle file drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    // Check if it's a file from the file browser (has custom data)
    const fileData = e.dataTransfer.getData('application/Eduscript-file')
    if (fileData) {
      try {
        const file = JSON.parse(fileData)
        onFileInsert?.(file)
        return
      } catch (error) {
        console.error('Error parsing file data:', error)
      }
    }

    // Handle computer file drops
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && chapterId) {
      try {
        for (const file of files) {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('uploadType', 'chapter')
          formData.append('chapterId', chapterId)

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })

          if (response.ok) {
            const uploadedFile = await response.json()
            onFileInsert?.(uploadedFile)
          }
        }
      } catch (error) {
        console.error('Error uploading dropped files:', error)
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
    if (!isMounted) return
    
    const updatePreview = async () => {
      try {
        const processed = await processMarkdown(
          useSimpleEditor ? textareaContent : editorContent, 
          { domain, chapterId }
        )
        setPreviewContent(processed.content)
      } catch (error) {
        console.error('Error processing markdown:', error)
        setPreviewContent('<p>Error processing markdown</p>')
      }
    }
    
    updatePreview()
  }, [editorContent, textareaContent, useSimpleEditor, isMounted, domain, chapterId])  // Initialize CodeMirror with dynamic imports
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
        const { markdown } = await import('@codemirror/lang-markdown')
        
        // Load theme extensions
        console.log('Loading @codemirror/theme-one-dark...')
        const { oneDark } = await import('@codemirror/theme-one-dark')
        
        console.log('All CodeMirror modules loaded successfully')

        console.log('Creating editor state...')
        const startState = EditorState.create({
          doc: editorContent,
          extensions: [
            basicSetup,
            markdown(),
            ...(isDark ? [oneDark] : []),
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
              },
              // Fix with specific selector that causes transparent selection background issues
              '&.cm-focused .cm-line ::selection': {
                backgroundColor: isDark ? 'rgba(59, 130, 246, 0.3) !important' : 'rgba(37, 99, 235, 0.3) !important',
              },
              '&.cm-focused .cm-line::selection': {
                backgroundColor: isDark ? 'rgba(59, 130, 246, 0.3) !important' : 'rgba(37, 99, 235, 0.3) !important',
              },
            }),
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
  }, [isMounted, isDark, editorContent, onChange]) // Re-initialize when theme changes

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
            <div
              className="p-4 prose-theme"
              dangerouslySetInnerHTML={{ __html: previewContent }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
