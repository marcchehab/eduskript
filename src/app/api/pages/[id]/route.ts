import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  updatePageForUser,
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
  console.error('Error updating page:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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

  try {
    const updated = await updatePageForUser(session.user.id, id, body, {
      isAdmin: session.user.isAdmin,
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

    const existingPage = await prisma.page.findFirst({
      where: {
        id,
        ...(session.user.isAdmin ? {} : { authors: { some: { userId: session.user.id } } }),
      },
    })

    if (!existingPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    await prisma.page.delete({ where: { id } })

    revalidatePath('/dashboard/page-builder')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting page:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
