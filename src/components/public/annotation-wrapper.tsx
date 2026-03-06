'use client'

import { ReactNode } from 'react'
import { AnnotationLayer } from '@/components/annotations/annotation-layer'
import { HighlightLayer } from '@/components/text-highlights/highlight-layer'
import { StickyNotesLayer } from '@/components/annotations/sticky-notes-layer'
import { TeacherBroadcastProvider } from '@/contexts/teacher-broadcast-context'
import { StickyNotesProvider } from '@/contexts/sticky-notes-context'
import type { Prisma } from '@prisma/client'

/** Public annotation data passed from server */
export interface PublicAnnotation {
  data: Prisma.JsonValue
  userId: string
  user: { name: string | null }
}

/** Public snap data passed from server (same structure as annotations) */
export interface PublicSnap {
  data: Prisma.JsonValue
  userId: string
  user: { name: string | null }
}

interface AnnotationWrapperProps {
  pageId: string
  content: string
  children: ReactNode
  /** Pre-fetched public annotations (from server) */
  publicAnnotations?: PublicAnnotation[]
  /** Pre-fetched public snaps (from server) */
  publicSnaps?: PublicSnap[]
  /** Whether current user can create public annotations */
  isPageAuthor?: boolean
  /** Whether user is a student in an exam session (for SEB mode where NextAuth session isn't available) */
  isExamStudent?: boolean
}

/**
 * Client-side wrapper that adds annotation functionality to server-rendered content.
 * The children (markdown content) are rendered on the server, this component adds
 * the annotation layer on the client.
 *
 * TeacherBroadcastProvider is included here to deduplicate teacher broadcast API calls.
 * Without it, each code editor and annotation layer would make separate API calls.
 * With the provider, all consumers share a single data source.
 */
export function AnnotationWrapper({ pageId, content, children, publicAnnotations, publicSnaps, isPageAuthor, isExamStudent }: AnnotationWrapperProps) {
  return (
    <StickyNotesProvider>
      <TeacherBroadcastProvider pageId={pageId}>
        <AnnotationLayer pageId={pageId} content={content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} isPageAuthor={isPageAuthor} isExamStudent={isExamStudent}>
          <StickyNotesLayer pageId={pageId}>
            <HighlightLayer pageId={pageId}>
              {children}
            </HighlightLayer>
          </StickyNotesLayer>
        </AnnotationLayer>
      </TeacherBroadcastProvider>
    </StickyNotesProvider>
  )
}
