'use client'

import dynamic from 'next/dynamic'

interface MarkdownEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  onFileInsert?: (file: any) => void
  chapterId?: string
  domain?: string
  isReadOnly?: boolean
}

// Create a client-only version using dynamic import
const CodeMirrorEditor = dynamic(
  () => import('./codemirror-editor'),
  {
    ssr: false,
    loading: () => (
      <div className="border border-border rounded-lg bg-card">
        <div className="p-4 min-h-[400px] flex items-center justify-center text-muted-foreground">
          Loading editor...
        </div>
      </div>
    )
  }
)

export function MarkdownEditor(props: MarkdownEditorProps) {
  return <CodeMirrorEditor {...props} />
}
