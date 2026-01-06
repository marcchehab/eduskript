'use client'

import { MarkdownRenderer } from '@/components/markdown/markdown-renderer.client'
import type { VideoInfo } from '@/lib/skript-files'

interface InteractivePreviewProps {
  markdown: string
  onContentChange?: (newContent: string) => void
  fileList?: Array<{ id: string; name: string; url?: string; isDirectory?: boolean }>
  videoList?: VideoInfo[]
  pageId?: string
  onExcalidrawEdit?: (filename: string, fileId: string) => void
}

export function InteractivePreview({
  markdown,
  onContentChange,
  fileList,
  videoList,
  pageId,
  onExcalidrawEdit,
}: InteractivePreviewProps) {
  // Filter out directories from the file list
  const filteredFileList = fileList?.filter(f => !f.isDirectory)

  return (
    <div className="prose-theme" key="markdown-preview">
      <MarkdownRenderer
        content={markdown}
        fileList={filteredFileList}
        videoList={videoList}
        pageId={pageId}
        onContentChange={onContentChange}
        onExcalidrawEdit={onExcalidrawEdit}
      />
    </div>
  )
}
