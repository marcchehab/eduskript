'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useRouter } from 'next/navigation'
import { registerPrintEditSource, unregisterPrintEditSource } from '@/lib/print/print-edit-state'
import { hasStages } from '@/lib/markdown-stages'

/**
 * Hands the page markdown the server rendered to the print preview's layout
 * editing (print-edit-state.ts), with router.refresh to re-render after a
 * save. Renders nothing. The markdown is already in the RSC payload
 * (AnnotationWrapper's `content`), so this adds nothing new to the client.
 *
 * Pages with <next-stage> register nothing: each stage is compiled on its
 * own, so source lines restart at 1 per stage and wouldn't match `content`.
 */
export function PrintEditSource({ pageId, content }: { pageId: string; content: string }) {
  const router = useRouter()
  // Layout effect: on a refreshed render, the optimistic placeholders go and
  // the page re-paginates before the first paint (print-edit-state.ts).
  useLayoutEffect(() => {
    if (hasStages(content)) { unregisterPrintEditSource(pageId); return }
    registerPrintEditSource(pageId, content, () => router.refresh())
  }, [pageId, content, router])
  useEffect(() => () => unregisterPrintEditSource(pageId), [pageId])
  return null
}
