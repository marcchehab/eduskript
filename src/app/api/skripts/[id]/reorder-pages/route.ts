import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { reorderSkriptPagesForUser } from '@/lib/services/skripts'
import { NotFoundError, PermissionDeniedError, ValidationError } from '@/lib/services/pages'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { pageIds } = await request.json()
    await reorderSkriptPagesForUser(session.user.id, id, pageIds, { isAdmin: session.user.isAdmin })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof NotFoundError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
    }
    console.error('Error reordering pages:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
