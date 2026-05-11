/**
 * Exam Header Component
 *
 * Fixed header shown during exam mode with:
 * - Hand in & Quit button (left side, always visible)
 * - Exam title (center)
 * - Student info, font controls, theme toggle (right side)
 */

'use client'

import { User } from 'lucide-react'
import { HandInButton } from './hand-in-button'
import { PublicThemeToggle } from '@/components/public/theme-toggle'
import { FontSizeControls } from '@/components/public/font-size-controls'

interface ExamHeaderProps {
  pageId: string
  pageTitle: string
  studentName?: string | null
  studentEmail?: string | null
  /** Teacher's active RSA-OAEP public key for offline backup encryption. */
  backupPublicKeyJwk?: JsonWebKey
  /** Short identifier embedded in .examfile backups so the server can look the key up. */
  backupKeyId?: string
  /** Current student's user id — needed for backup meta. */
  studentId?: string
  /** Containing skript's id — needed for backup meta. */
  skriptId?: string
}

export function ExamHeader({
  pageId,
  pageTitle,
  studentName,
  studentEmail,
  backupPublicKeyJwk,
  backupKeyId,
  studentId,
  skriptId,
}: ExamHeaderProps) {
  // Determine what to display for the student
  const displayName = studentName || studentEmail || 'Student'
  const displayEmail = studentName && studentEmail ? studentEmail : null

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b border-border shadow-sm">
      <div className="h-full px-4 flex items-center justify-between">
        {/* Left: Hand in button */}
        <div className="flex-shrink-0">
          <HandInButton
            pageId={pageId}
            publicKeyJwk={backupPublicKeyJwk}
            keyId={backupKeyId}
            studentId={studentId}
            skriptId={skriptId}
          />
        </div>

        {/* Center: Exam title */}
        <div className="flex-1 min-w-0 mx-4">
          <h1 className="text-sm font-medium text-foreground truncate text-center">
            {pageTitle}
          </h1>
        </div>

        {/* Right: Controls and student info */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Student info */}
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            <User className="w-4 h-4" />
            <div className="flex flex-col leading-tight">
              <span className="font-medium text-foreground">{displayName}</span>
              {displayEmail && (
                <span className="text-xs">{displayEmail}</span>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px h-6 bg-border" />

          {/* Controls */}
          <FontSizeControls />
          <PublicThemeToggle />
        </div>
      </div>
    </header>
  )
}
