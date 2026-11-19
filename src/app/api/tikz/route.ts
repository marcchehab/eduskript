/**
 * POST /api/tikz { source, skriptId? } → { image } | { error }
 *
 * Renders a ```tikz block for places that compile markdown in the browser (the
 * editor preview, teacher-only content). Public pages render on the server and
 * never call this. Signed-in users only, and rate-limited: running TeX is cheap
 * but not free.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { RateLimiter } from '@/lib/rate-limit'
import { getSkriptFiles } from '@/lib/skript-files.server'
import { TIKZ_MAX_SOURCE } from '@/lib/tikz/document'
import { renderTikzForSkript } from '@/lib/tikz/skript.server'

export const runtime = 'nodejs'

const limiter = new RateLimiter('tikz', { interval: 60 * 1000, maxRequests: 90 })

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in to render TikZ.' }, { status: 401 })

  if (!limiter.check(session.user.id).allowed) {
    return NextResponse.json({ error: 'Too many TikZ renders. Try again in a minute.' }, { status: 429 })
  }

  let body: { source?: unknown; skriptId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { source, skriptId } = body
  if (typeof source !== 'string' || source.length === 0 || source.length > TIKZ_MAX_SOURCE) {
    return NextResponse.json({ error: 'Invalid TikZ source.' }, { status: 400 })
  }

  // Skript files are public (the page shows them); only the preamble is read.
  const files = typeof skriptId === 'string' && skriptId ? await getSkriptFiles(skriptId) : undefined
  return NextResponse.json(await renderTikzForSkript(source, files))
}
