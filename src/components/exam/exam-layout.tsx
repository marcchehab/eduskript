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

interface ExamLayoutProps {
  children: React.ReactNode
  pageId: string
  pageTitle: string
  studentName?: string | null
  studentEmail?: string | null
  typographyPreference?: 'modern' | 'classic'
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
  backupPublicKeyJwk,
  backupKeyId,
  studentId,
  skriptId,
}: ExamLayoutProps) {
  return (
    <div
      className="min-h-screen bg-background"
      data-typography={typographyPreference}
    >
      <ReadingProgress />

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

      {/* Main content - full width, no sidebar */}
      <main className="pt-16 px-6 lg:px-8 pb-8 max-w-4xl mx-auto">
        {children}
      </main>
    </div>
  )
}
