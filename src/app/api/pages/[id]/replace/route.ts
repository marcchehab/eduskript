/**
 * POST { old, new, line? } — replace one exact piece of a page's markdown.
 *
 * For edits made on the public page (first user: Kara voice lines in a level,
 * src/components/public/code-editor/kara-voice-editor.tsx). `old` must occur
 * exactly once in the current content, otherwise 409: the page changed since
 * the client loaded it, or the snippet is ambiguous. The write goes through
 * updatePageForUser (same permission rule, PageVersion and cache
 * invalidation as a dashboard save), attributed as editSource "inline".
 *
 * With `line` (1-based), `old` (non-empty) must instead be exactly the lines
 * starting at that line; it may occur elsewhere too. Used by the print
 * preview's layout edits (src/lib/print/print-edits.ts lineRangeEdit), where
 * the same image line can repeat on a page.
 *
 * Known limitation: read and write are two steps; a save landing between
 * them is overwritten (no row lock). Fine for single-author inline tweaks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NotFoundError, PermissionDeniedError, ValidationError, loadPageForActor, updatePageForUser } from '@/lib/services/pages'

const MAX_SNIPPET = 200_000

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.accountType === 'student') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { old?: unknown; new?: unknown; line?: unknown } | null
  const oldText = body?.old
  const newText = body?.new
  const line = body?.line
  if (typeof oldText !== 'string' || typeof newText !== 'string' || !oldText || oldText.length > MAX_SNIPPET || newText.length > MAX_SNIPPET) {
    return NextResponse.json({ error: 'old and new (strings) required' }, { status: 400 })
  }

  // Permission before comparing: otherwise 409 vs 403 would tell anyone
  // whether a guessed snippet is in a page they can't edit.
  const page = await loadPageForActor(id, session.user.id, !!session.user.isAdmin)
  if (!page) return NextResponse.json({ error: 'You cannot edit this page.' }, { status: 403 })
  if (line !== undefined) {
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
      return NextResponse.json({ error: 'line must be a positive integer' }, { status: 400 })
    }
    const lines = page.content.split('\n')
    const oldLines = oldText.split('\n')
    if (line - 1 + oldLines.length > lines.length || lines.slice(line - 1, line - 1 + oldLines.length).join('\n') !== oldText) {
      return NextResponse.json({ error: 'The page changed meanwhile. Reload and try again.' }, { status: 409 })
    }
    const next = [...lines.slice(0, line - 1), newText, ...lines.slice(line - 1 + oldLines.length)].join('\n')
    return save(session.user.id, session.user.isAdmin, id, next)
  }

  const at = page.content.indexOf(oldText)
  if (at === -1 || page.content.indexOf(oldText, at + 1) !== -1) {
    return NextResponse.json(
      { error: at === -1 ? 'The page changed meanwhile. Reload and try again.' : 'This text occurs more than once on the page.' },
      { status: 409 },
    )
  }
  const content = page.content.slice(0, at) + newText + page.content.slice(at + oldText.length)
  return save(session.user.id, session.user.isAdmin, id, content)
}

async function save(userId: string, isAdmin: boolean | undefined, id: string, content: string) {
  try {
    await updatePageForUser(userId, id, { content }, { isAdmin, editSource: 'inline' })
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof NotFoundError) {
      return NextResponse.json({ error: 'You cannot edit this page.' }, { status: 403 })
    }
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[pages/replace]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  // The saved content: the print preview (print-edit-state.ts) waits for the
  // page to render exactly this, which differs from its own result when the
  // page was changed elsewhere meanwhile.
  return NextResponse.json({ ok: true, content })
}
