/**
 * Exam Layout Component
 *
 * A simplified layout for exam mode that removes the sidebar
 * and provides a focused exam-taking experience.
 *
 * Features:
 * - No sidebar navigation (lockdown mode)
 * - Hand in & Quit button always visible
 * - Student name/email in header
 * - Font size and theme controls retained
 */

'use client'

import { ExamHeader } from './exam-header'
import { ReadingProgress } from '@/components/public/reading-progress'
import type { ThemePreset } from '@/lib/settings'

interface ExamLayoutProps {
  children: React.ReactNode
  pageId: string
  pageTitle: string
  studentName?: string | null
  studentEmail?: string | null
  typographyPreference?: ThemePreset
  /** Site's reading-progress toggle (Site.extraSettings.hideReadingProgress). */
  showReadingProgress?: boolean
  /** Teacher's active RSA-OAEP public key for the offline backup feature. */
  backupPublicKeyJwk?: JsonWebKey
  backupKeyId?: string
  studentId?: string
  skriptId?: string
}

export function ExamLayout({
  children,
  pageId,
  pageTitle,
  studentName,
  studentEmail,
  typographyPreference = 'modern',
  showReadingProgress = true,
  backupPublicKeyJwk,
  backupKeyId,
  studentId,
  skriptId,
}: ExamLayoutProps) {
  return (
    <div
      className="h-screen overflow-hidden bg-background"
      data-typography={typographyPreference}
    >
      {showReadingProgress && <ReadingProgress />}

      {/* Exam Header - fixed at top */}
      <ExamHeader
        pageId={pageId}
        pageTitle={pageTitle}
        studentName={studentName}
        studentEmail={studentEmail}
        backupPublicKeyJwk={backupPublicKeyJwk}
        backupKeyId={backupKeyId}
        studentId={studentId}
        skriptId={skriptId}
      />

      {/* Scroll container — AnnotationLayer's pinch-zoom + pan target, and what
          ReadingProgress measures. Must mirror PublicSiteLayout's
          #scroll-container (relative h-screen overflow-auto): without it,
          AnnotationLayer's scrollContainerRef is null and the pinch handler
          bails (pinch-zoom + pan were dead on exam pages in SEB on iPad).
          relative: hosts the absolutely-positioned zoom-spacer.
          Main keeps pt-16 to clear the fixed ExamHeader. */}
      <div id="scroll-container" className="relative h-screen overflow-auto">
        <main className="pt-16 px-6 lg:px-8 pb-8 max-w-4xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
