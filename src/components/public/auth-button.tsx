'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, UserCheck, FilePen, Copy, BookOpen, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const [canCopy, setCanCopy] = useState(false)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [skripts, setSkripts] = useState<{ id: string; title: string; slug: string }[]>([])
  const [skriptsLoading, setSkriptsLoading] = useState(false)
  const [copyResult, setCopyResult] = useState<{ success: boolean; message: string } | null>(null)
  const [copying, setCopying] = useState(false)
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
          setCanCopy(!data.canEdit && !!data.canCopy)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEditUrl(null)
          setCanCopy(false)
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
    const knownHosts = ['localhost', 'eduskript.org', 'www.eduskript.org']
    const appHostname = process.env.NEXT_PUBLIC_APP_HOSTNAME
    if (appHostname && !knownHosts.includes(appHostname)) {
      knownHosts.push(appHostname)
    }
    const isCustomDomain = !knownHosts.includes(hostname)

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

  // Teacher viewing another teacher's copyable page — show copy button
  if (canCopy && !isStudent) {
    const openCopyDialog = () => {
      setCopyDialogOpen(true)
      setCopyResult(null)
      setSkriptsLoading(true)
      fetch('/api/skripts/list')
        .then(res => res.ok ? res.json() : [])
        .then(data => setSkripts(data))
        .catch(() => setSkripts([]))
        .finally(() => setSkriptsLoading(false))
    }

    const handleCopy = async (targetSkriptId: string) => {
      setCopying(true)
      setCopyResult(null)
      try {
        const res = await fetch(`/api/pages/${pageId}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetSkriptId }),
        })
        const data = await res.json()
        if (!res.ok) {
          setCopyResult({ success: false, message: data.error || 'Failed to copy page' })
        } else {
          setCopyResult({ success: true, message: `Copied as draft to your skript` })
        }
      } catch {
        setCopyResult({ success: false, message: 'Network error' })
      } finally {
        setCopying(false)
      }
    }

    return (
      <>
        <button
          onClick={openCopyDialog}
          title="Copy this page to your skripts"
          className="relative h-8 w-8 rounded-md border border-border bg-card hover:bg-muted transition-colors overflow-hidden inline-flex items-center justify-center"
        >
          {session.user?.image ? (
            <>
              <Image src={session.user.image} alt={userName} fill className="object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-primary/70">
                <Copy className="h-4 w-4 text-primary-foreground" />
              </div>
            </>
          ) : (
            <Copy className="h-4 w-4 text-primary" />
          )}
        </button>

        <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Copy this page to your skripts</DialogTitle>
            </DialogHeader>
            {copyResult ? (
              <p className={`text-sm p-3 rounded-md ${
                copyResult.success
                  ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              }`}>
                {copyResult.message}
              </p>
            ) : skriptsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : skripts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                You don&apos;t have any skripts to copy into. Create a skript first.
              </p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                <p className="text-sm text-muted-foreground mb-2">Select a skript:</p>
                {skripts.map(skript => (
                  <button
                    key={skript.id}
                    onClick={() => handleCopy(skript.id)}
                    disabled={copying}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {copying ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {skript.title}
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
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
