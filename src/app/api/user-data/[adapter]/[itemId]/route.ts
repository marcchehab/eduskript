/**
 * User Data Item API
 *
 * GET /api/user-data/[adapter]/[itemId]
 * Fetch a single user data item.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    adapter: string
    itemId: string
  }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { adapter, itemId } = await params

    // Fetch personal data (no targeting)
    const item = await prisma.userData.findFirst({
      where: {
        userId,
        adapter,
        itemId: decodeURIComponent(itemId),
        targetType: null,
        targetId: null,
      },
    })

    if (!item) {
      // Return null data for items that don't exist yet - this is expected for
      // quizzes/editors that haven't been interacted with, not an error
      return NextResponse.json({
        adapter,
        itemId: decodeURIComponent(itemId),
        data: null,
        version: 0,
        updatedAt: null,
      })
    }

    return NextResponse.json({
      adapter: item.adapter,
      itemId: item.itemId,
      data: item.data,
      version: item.version,
      updatedAt: item.updatedAt.getTime(),
    })
  } catch (error) {
    console.error('[user-data/item] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { adapter, itemId } = await params
    const decodedItemId = decodeURIComponent(itemId)

    // Delete the item if it exists
    await prisma.userData.deleteMany({
      where: {
        userId,
        adapter,
        itemId: decodedItemId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[user-data/item] Delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
