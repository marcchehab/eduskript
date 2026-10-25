import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  movePageForUser,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '@/lib/services/pages'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pageId, targetSkriptId } = await request.json()
    if (!pageId || !targetSkriptId) {
      return NextResponse.json({ error: 'pageId and targetSkriptId are required' }, { status: 400 })
    }

    const result = await movePageForUser(session.user.id, pageId, targetSkriptId, {
      isAdmin: session.user.isAdmin,
    })
    return NextResponse.json({
      success: true,
      targetSkriptSlug: result.targetSkriptSlug,
      pageSlug: result.pageSlug,
    })
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
    console.error('Error moving page:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
