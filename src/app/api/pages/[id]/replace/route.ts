/**
 * POST { old, new } — replace one exact piece of a page's markdown.
 *
 * For edits made on the public page (first user: Kara voice lines in a level,
 * src/components/public/code-editor/kara-voice-editor.tsx). `old` must occur
 * exactly once in the current content, otherwise 409: the page changed since
 * the client loaded it, or the snippet is ambiguous. The write goes through
 * updatePageForUser (same permission rule, PageVersion and cache
 * invalidation as a dashboard save), attributed as editSource "inline".
 *
 * Known limitation: read and write are two steps; a save landing between
 * them is overwritten (no row lock). Fine for single-author inline tweaks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotFoundError, PermissionDeniedError, ValidationError, updatePageForUser } from '@/lib/services/pages'

const MAX_SNIPPET = 200_000

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.accountType === 'student') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { old?: unknown; new?: unknown } | null
  const oldText = body?.old
  const newText = body?.new
  if (typeof oldText !== 'string' || typeof newText !== 'string' || !oldText || oldText.length > MAX_SNIPPET || newText.length > MAX_SNIPPET) {
    return NextResponse.json({ error: 'old and new (strings) required' }, { status: 400 })
  }

  const page = await prisma.page.findUnique({ where: { id }, select: { content: true } })
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  const at = page.content.indexOf(oldText)
  if (at === -1 || page.content.indexOf(oldText, at + 1) !== -1) {
    return NextResponse.json(
      { error: at === -1 ? 'The page changed meanwhile. Reload and try again.' : 'This text occurs more than once on the page.' },
      { status: 409 },
    )
  }
  const content = page.content.slice(0, at) + newText + page.content.slice(at + oldText.length)

  try {
    await updatePageForUser(session.user.id, id, { content }, { isAdmin: session.user.isAdmin, editSource: 'inline' })
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof NotFoundError) {
      return NextResponse.json({ error: 'You cannot edit this page.' }, { status: 403 })
    }
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[pages/replace]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
