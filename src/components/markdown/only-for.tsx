'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { Lock } from 'lucide-react'

// Audience gate for markdown content. Wraps children; shows them only to the
// named audience, with a friendly locked notice for everyone else. Successor to
// the old <isauthenticated>. Modes (most-specific wins):
//   <onlyfor auth>        — any signed-in user
//   <onlyfor anon>        — only signed-OUT viewers (e.g. a sign-in CTA)
//   <onlyfor students>    — the page owner's students (any of their classes)
//   <onlyfor class="3a">  — students in the owner's class "3a" (name or invite code)
//   prompt="…"            — custom locked-state text
//
// SOFT gate: on cached public pages this hides on the CLIENT, so children still
// exist in the page source. Safe for UX gating and for <login-codes> (its codes
// endpoint is independently auth-gated). Not a substitute for server-side
// secrecy. auth/anon need no network; students/class call /api/viewer/access.

type Mode = 'auth' | 'anon' | 'students' | 'class'

function present(v: unknown): boolean {
  // Markdown boolean attrs arrive as "" (e.g. <onlyfor auth> → auth="").
  return v !== undefined && v !== false && v !== 'false'
}

function firstString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return undefined
}

export function OnlyFor(props: {
  children?: ReactNode
  ownerPageSlug?: string
  prompt?: string
  [key: string]: unknown
}) {
  const { children, ownerPageSlug, prompt } = props
  // `class="3a"` lands as className through the HTML→hast property mapping.
  const klass = firstString(props.class) ?? firstString(props.className)

  const mode: Mode = klass
    ? 'class'
    : present(props.students)
      ? 'students'
      : present(props.anon)
        ? 'anon'
        : 'auth'

  const { status } = useSession() // 'loading' | 'authenticated' | 'unauthenticated'
  const pathname = usePathname()
  const needsServer = mode === 'students' || mode === 'class'
  const [serverOk, setServerOk] = useState<boolean | null>(null)

  useEffect(() => {
    // Only the signed-in + students/class case needs a server check. The
    // not-authenticated case is resolved at render time (unlocked = false), so
    // no setState here — keeps the effect side-effect-free until fetch resolves.
    if (!needsServer) return
    if (status !== 'authenticated') return
    let cancelled = false
    const qs = new URLSearchParams()
    // Owner comes from the render context; fall back to the first path segment
    // (path-based routing: /<ownerPageSlug>/…).
    const owner = ownerPageSlug || pathname?.split('/').filter(Boolean)[0]
    if (owner) qs.set('owner', owner)
    if (mode === 'class' && klass) qs.set('class', klass)
    fetch(`/api/viewer/access?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (!d) return setServerOk(false)
        setServerOk(mode === 'class' ? !!d.inClass : !!d.isStudent)
      })
      .catch(() => !cancelled && setServerOk(false))
    return () => {
      cancelled = true
    }
  }, [needsServer, status, ownerPageSlug, pathname, mode, klass])

  const authed = status === 'authenticated'

  let unlocked: boolean | null
  if (status === 'loading') unlocked = null
  else if (mode === 'auth') unlocked = authed
  else if (mode === 'anon') unlocked = !authed
  else if (!authed) unlocked = false
  else unlocked = serverOk // null while the access check is in flight

  if (unlocked === null) return null // resolving — avoid a flash of locked state
  if (unlocked) return <>{children}</>
  if (mode === 'anon') return null // signed-in users simply don't see anon blocks

  return <LockedNotice mode={mode} authed={authed} prompt={prompt} pathname={pathname} />
}

function LockedNotice({
  mode,
  authed,
  prompt,
  pathname,
}: {
  mode: Mode
  authed: boolean
  prompt?: string
  pathname: string | null
}) {
  const message =
    prompt ??
    (!authed
      ? 'Sign in to view this content.'
      : mode === 'class'
        ? 'This content is for students in this class.'
        : 'This content is for this teacher’s students.')

  const signInHref = `/auth/signin${
    pathname ? `?callbackUrl=${encodeURIComponent(pathname)}` : ''
  }`

  return (
    <div className="my-4 flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Lock className="h-4 w-4 shrink-0" />
      <span>{message}</span>
      {!authed && (
        <a href={signInHref} className="ml-auto font-medium text-primary underline">
          Sign in
        </a>
      )}
    </div>
  )
}
