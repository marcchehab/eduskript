'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-react'

interface DebugEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  isReadOnly?: boolean
}

export default function DebugEditor({ 
  content, 
  onChange, 
  onSave,
  isReadOnly = false 
}: DebugEditorProps) {
  const [editorContent, setEditorContent] = useState(content || '')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    console.log('DebugEditor mounted with content:', content?.substring(0, 100))
  }, [content])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setEditorContent(newContent)
    onChange(newContent)
  }

  if (!mounted) {
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
        <div className="p-4 min-h-[400px] flex items-center justify-center text-gray-500">
          Mounting debug editor...
        </div>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
      {/* Toolbar */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-destructive font-semibold">DEBUG EDITOR - CodeMirror Failed to Load</span>
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

      {/* Editor */}
      <div className="p-4">
        <textarea
          value={editorContent}
          onChange={handleChange}
          readOnly={isReadOnly}
          className="w-full h-96 p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Start typing your markdown here..."
        />
        <div className="mt-2 text-xs text-gray-500">
          Content length: {editorContent.length} characters
        </div>
      </div>
    </div>
  )
}
