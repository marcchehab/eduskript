import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  createPageForUser,
} from '@/lib/services/pages'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title, slug, content, skriptId } = body

  // See PATCH handler in [id]/route.ts — only accept "ai-edit"; "mcp" must
  // come through the actual MCP transport, not from a REST body.
  const editSource = body?.editSource === 'ai-edit' ? 'ai-edit' : undefined

  try {
    const page = await createPageForUser(
      session.user.id,
      { title, slug, content, skriptId },
      { isAdmin: session.user.isAdmin, editSource }
    )
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('Error creating page:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
