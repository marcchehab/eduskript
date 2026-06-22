'use client'

import { useEffect, useMemo, useState } from 'react'
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer.client'
import type { VideoInfo } from '@/lib/skript-files'

// Module-level cache so the site language is fetched once per session, not on
// every editor mount. null = not yet loaded → footnote heading defaults to
// English until it resolves.
let cachedPageLanguage: string | null | undefined

interface InteractivePreviewProps {
  markdown: string
  onContentChange?: (newContent: string) => void
  fileList?: Array<{ id: string; name: string; url?: string; isDirectory?: boolean; updatedAt?: string | Date; width?: number; height?: number }>
  videoList?: VideoInfo[]
  pageId?: string
  skriptId?: string
  onExcalidrawEdit?: (filename: string, fileId: string) => void
}

export function InteractivePreview({
  markdown,
  onContentChange,
  fileList,
  videoList,
  pageId,
  skriptId,
  onExcalidrawEdit,
}: InteractivePreviewProps) {
  // Memoize to avoid new array reference on every parent re-render
  const filteredFileList = useMemo(() => fileList?.filter(f => !f.isDirectory), [fileList])

  // Site language drives the localized GFM footnotes heading so the preview
  // matches the published page. Fetched once (cached at module scope); falls
  // back to English on the demo/unauthenticated path where the call 401s.
  const [pageLanguage, setPageLanguage] = useState<string | null | undefined>(cachedPageLanguage)
  useEffect(() => {
    if (cachedPageLanguage !== undefined) return
    let cancelled = false
    fetch('/api/user/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        cachedPageLanguage = data?.pageLanguage ?? null
        if (!cancelled) setPageLanguage(cachedPageLanguage)
      })
      .catch(() => { cachedPageLanguage = null })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="prose-theme" key="markdown-preview">
      <MarkdownRenderer
        content={markdown}
        fileList={filteredFileList}
        videoList={videoList}
        pageId={pageId}
        skriptId={skriptId}
        onContentChange={onContentChange}
        onExcalidrawEdit={onExcalidrawEdit}
        pageLanguage={pageLanguage}
      />
    </div>
  )
}
