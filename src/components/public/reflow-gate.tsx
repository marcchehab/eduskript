'use client'

import type { ReactNode } from 'react'
import { AnnotationWrapper, type PublicAnnotation, type PublicSnap } from '@/components/public/annotation-wrapper'
import type { StickyNote } from '@/components/annotations/sticky-notes-layer'
import { useReflowMode } from '@/hooks/use-reflow-mode'

interface ReflowGateProps {
  pageId: string
  content: string
  publicAnnotations: PublicAnnotation[]
  publicSnaps: PublicSnap[]
  publicStickyNotes: StickyNote[]
  isExamStudent?: boolean
  children: ReactNode
}

/**
 * Decides whether the annotation system is mounted at all. In reflow mode the
 * whole AnnotationWrapper subtree (pen toolbar, canvas, snaps, sticky notes,
 * highlights, scroll-hijack, zoom/pan) is unmounted and the server-rendered
 * markdown (`children`) is rendered bare so it reflows normally.
 *
 * Before mount we always render WITH annotations so SSR and the first client
 * render match — this keeps the desktop common case hydration-safe and
 * flash-free. On phones the reflow-mode class (set pre-paint in layout.tsx)
 * already neutralizes the paper geometry visually, so the layer mounts for a
 * single tick and then unmounts here. Accepted cost of staying hydration-safe;
 * the alternative (deciding during SSR) needs a cookie and opts pages out of
 * ISR. See use-reflow-mode.ts.
 */
export function ReflowGate({ children, ...annotationProps }: ReflowGateProps) {
  const { reflow, mounted } = useReflowMode()

  if (mounted && reflow) return <>{children}</>

  return <AnnotationWrapper {...annotationProps}>{children}</AnnotationWrapper>
}
