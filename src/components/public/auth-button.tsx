'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, UserCheck, Pencil } from 'lucide-react'

interface AuthButtonProps {
  pageId?: string // Page ID to check edit permissions (lazy loaded)
}

export function AuthButton({ pageId }: AuthButtonProps) {
  const pathname = usePathname() ?? '/'
  const { data: session, status } = useSession()
  const [editUrl, setEditUrl] = useState<string | null>(null)

  // Extract pageSlug from pathname (first segment after /)
  // e.g., /chris/collection/skript/page -> "chris"
  const pageSlug = pathname.split('/')[1] || undefined

  // Fetch edit permissions client-side (only when logged in and pageId is provided)
  useEffect(() => {
    // Skip if not authenticated, no pageId, or student account
    if (status !== 'authenticated' || !pageId || session?.user?.accountType === 'student') {
      return
    }

    let cancelled = false

    fetch(`/api/pages/${pageId}/can-edit`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          setEditUrl(data.canEdit && data.editUrl ? data.editUrl : null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEditUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pageId, status, session?.user?.accountType])

  // Build sign-in URL with context
  // If on a teacher's page, include 'from' param for student context
  const signInUrl = pageSlug && !['auth', 'dashboard', 'api'].includes(pageSlug)
    ? `/auth/signin?from=${encodeURIComponent(pageSlug)}&callbackUrl=${encodeURIComponent(pathname)}`
    : `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`

  if (!session) {
    // Not logged in - show login button
    return (
      <Link
        href={signInUrl}
        title="Sign in"
        className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors inline-flex items-center justify-center"
      >
        <LogIn className="h-4 w-4" />
      </Link>
    )
  }

  // Logged in - show edit button or user avatar/icon
  const isStudent = session.user?.accountType === 'student'
  const userName = isStudent
    ? (session.user?.studentPseudonym
        ? `Student ${session.user.studentPseudonym.substring(0, 4)}`
        : 'Student')
    : session.user?.name || 'User'

  // If user can edit this page, show edit button instead of dashboard button
  if (editUrl && !isStudent) {
    return (
      <Link
        href={editUrl}
        title="Edit this page"
        className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors overflow-hidden inline-flex items-center justify-center"
      >
        <Pencil className="h-4 w-4 text-primary" />
      </Link>
    )
  }

  return (
    <Link
      href="/dashboard"
      title={`Go to dashboard (${userName})`}
      className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors overflow-hidden inline-flex items-center justify-center"
    >
      {session.user?.image && !isStudent ? (
        // Show profile picture for teachers (Microsoft provides it, not stored on server)
        // For students: don't show image even if Microsoft provides one (privacy)
        <Image
          src={session.user.image}
          alt={userName}
          width={16}
          height={16}
          className="rounded-sm opacity-90 hover:opacity-100 transition-opacity"
        />
      ) : (
        // Show icon for students or teachers without images
        <UserCheck className="h-4 w-4 text-primary" />
      )}
    </Link>
  )
}
