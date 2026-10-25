import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  StaleContentError,
  ValidationError,
  getPageForEditor,
  invalidatePublicPageCaches,
  updatePageForUser,
  deletePageForUser,
} from '@/lib/services/pages'

function errorToResponse(error: unknown): NextResponse {
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
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof StaleContentError) {
    return NextResponse.json({ error: error.message, stale: true }, { status: 409 })
  }
  console.error('Error updating page:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// Editor freshness check: the page editor compares this with the state it was
// rendered with (the router cache can restore an old render on Back).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    return NextResponse.json(await getPageForEditor(session.user.id, id, { isAdmin: session.user.isAdmin }))
  } catch (error) {
    return errorToResponse(error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()

  // editSource may be sent by the dashboard's AI Edit Apply flow. Only honor
  // the literal "ai-edit" — never accept "mcp" from REST (would let a malicious
  // dashboard request fake an MCP attribution).
  const editSource = body?.editSource === 'ai-edit' ? 'ai-edit' : undefined
  // confirmDestructive opts out of the empty-content guard. Dashboard editor
  // currently never wipes content, so this stays defensive — passed through
  // for parity with the MCP update_page_content tool.
  const allowEmptyContent = body?.confirmDestructive === true
  // Strip control fields from the patch so they don't reach prisma.page.update
  // as columns.
  const { editSource: _e, confirmDestructive: _c, ...patch } = body ?? {}

  try {
    const updated = await updatePageForUser(session.user.id, id, patch, {
      isAdmin: session.user.isAdmin,
      editSource,
      allowEmptyContent,
    })
    return NextResponse.json(updated)
  } catch (error) {
    return errorToResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    await deletePageForUser(session.user.id, id, { isAdmin: session.user.isAdmin })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PermissionDeniedError) {
      return errorToResponse(error)
    }
    console.error('Error deleting page:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
