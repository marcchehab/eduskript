'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, UserCheck, FilePen } from 'lucide-react'

interface AuthButtonProps {
  pageId?: string // Page ID to check edit permissions (lazy loaded)
  teacherPageSlug?: string // Teacher's pageSlug for custom domain auth redirect
  isOrgPage?: boolean // Whether the current page is an org page
  orgSlug?: string // Org slug for org page context
}

export function AuthButton({ pageId, teacherPageSlug, isOrgPage, orgSlug }: AuthButtonProps) {
  const pathname = usePathname() ?? '/'
  const { data: session, status } = useSession()
  const [editUrl, setEditUrl] = useState<string | null>(null)
  // Extract pageSlug from pathname (first segment after /)
  // e.g., /chris/collection/skript/page -> "chris"
  // On custom domains, use the passed teacherPageSlug instead
  const pageSlug = teacherPageSlug || pathname.split('/')[1] || undefined

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
  // 'from' param tells the sign-in page what context the user is coming from:
  // - "org/<slug>" for org pages → shows two-column teacher/student layout
  // - "<pageSlug>" for teacher pages → shows student-focused layout
  const [signInUrl, setSignInUrl] = useState(() => {
    const fromParam = isOrgPage && orgSlug
      ? `org/${orgSlug}`
      : pageSlug && !['auth', 'dashboard', 'api'].includes(pageSlug)
        ? pageSlug
        : undefined
    const baseSignIn = fromParam
      ? `/auth/signin?from=${encodeURIComponent(fromParam)}&callbackUrl=${encodeURIComponent(pathname)}`
      : `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`
    return baseSignIn
  })

  useEffect(() => {
    // On custom domains, auth must happen on main site (cookies don't transfer across domains)
    const hostname = window.location.hostname
    const isCustomDomain = !['localhost', 'eduskript.org', 'www.eduskript.org'].includes(hostname)

    if (isCustomDomain && pageSlug) {
      // After OAuth completes, redirect to cross-domain endpoint which will:
      // 1. Generate a one-time token
      // 2. Redirect to the custom domain with the token
      // 3. Custom domain callback sets the session cookie
      // NOTE: 'from' param is included so isStudentSignup can detect student context
      // even though the path is /api/... (a reserved path)
      const crossDomainCallback = `https://eduskript.org/api/auth/cross-domain?returnDomain=${encodeURIComponent(hostname)}&returnPath=${encodeURIComponent(pathname)}&from=${encodeURIComponent(pageSlug)}`
      const baseSignIn = `https://eduskript.org/auth/signin?from=${encodeURIComponent(pageSlug)}&callbackUrl=${encodeURIComponent(crossDomainCallback)}`
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Required: domain detection only possible after mount
      setSignInUrl(baseSignIn)
    }
  }, [pathname, pageSlug])

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

  // If user can edit this page, show profile picture with edit overlay
  if (editUrl && !isStudent) {
    return (
      <Link
        href={editUrl}
        title="Edit this page"
        className="relative h-8 w-8 rounded-md border border-border bg-card hover:bg-muted transition-colors overflow-hidden inline-flex items-center justify-center"
      >
        {session.user?.image ? (
          <>
            <Image
              src={session.user.image}
              alt={userName}
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-primary/70">
              <FilePen className="h-4 w-4 text-primary-foreground" />
            </div>
          </>
        ) : (
          <FilePen className="h-4 w-4 text-primary" />
        )}
      </Link>
    )
  }

  return (
    <Link
      href="/dashboard"
      title={`Go to dashboard (${userName})`}
      className="relative h-8 w-8 rounded-md border border-border bg-card hover:bg-muted transition-colors inline-flex items-center justify-center"
    >
      {session.user?.image ? (
        // Show profile picture (OAuth image passed through session, not stored for students)
        <div className="absolute inset-0 overflow-hidden rounded-md">
          <Image
            src={session.user.image}
            alt={userName}
            fill
            className="object-cover opacity-90 hover:opacity-100 transition-opacity"
          />
        </div>
      ) : (
        // Show icon for users without images
        <UserCheck className="h-4 w-4 text-primary" />
      )}
    </Link>
  )
}
