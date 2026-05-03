import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  restorePageVersionForUser,
} from '@/lib/services/pages'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, versionId } = await params

  try {
    const result = await restorePageVersionForUser(
      session.user.id,
      id,
      versionId,
      { isAdmin: session.user.isAdmin },
    )
    return NextResponse.json({ success: true, ...result })
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
    console.error('Error restoring version:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
