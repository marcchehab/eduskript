'use client'

import { ReactNode } from 'react'
import { AnnotationLayer } from '@/components/annotations/annotation-layer'
import { TeacherBroadcastProvider } from '@/contexts/teacher-broadcast-context'
import type { Prisma } from '@prisma/client'

/** Public annotation data passed from server */
export interface PublicAnnotation {
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
  /** Whether current user can create public annotations */
  isPageAuthor?: boolean
  /** Whether user is a student in an exam session (for SEB mode where NextAuth session isn't available) */
  isExamStudent?: boolean
}

/**
 * Client-side wrapper that adds annotation functionality to server-rendered content.
 * The children (MDX content) are rendered on the server, this component adds
 * the annotation layer on the client.
 *
 * TeacherBroadcastProvider is included here to deduplicate teacher broadcast API calls.
 * Without it, each code editor and annotation layer would make separate API calls.
 * With the provider, all consumers share a single data source.
 */
export function AnnotationWrapper({ pageId, content, children, publicAnnotations, isPageAuthor, isExamStudent }: AnnotationWrapperProps) {
  return (
    <TeacherBroadcastProvider pageId={pageId}>
      <AnnotationLayer pageId={pageId} content={content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor} isExamStudent={isExamStudent}>
        {children}
      </AnnotationLayer>
    </TeacherBroadcastProvider>
  )
}
