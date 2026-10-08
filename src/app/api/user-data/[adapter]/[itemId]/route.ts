/**
 * User Data Item API
 *
 * GET /api/user-data/[adapter]/[itemId]?siteId=…[&targetType=&targetId=]
 * Fetch a single user data item ON ONE SITE (site scoping,
 * src/lib/site-access.ts). The siteId param is required; an EMPTY value
 * (`?siteId=`) reads server-owned account rows (siteId '', e.g. the
 * onboarding quest at itemId 'global').
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
    const { adapter, itemId } = await params
    const decodedItemId = decodeURIComponent(itemId)

    // Check for targeting query params (for teacher broadcast/feedback)
    const { searchParams } = new URL(request.url)
    const targetType = searchParams.get('targetType') as 'class' | 'student' | 'page' | null
    const targetId = searchParams.get('targetId')
    const siteId = searchParams.get('siteId')
    if (siteId === null) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    // Public page annotations can be read by anyone (no auth required). The
    // caller's own row wins (a site manager editing their public layer must
    // continue from THEIR row, not a co-manager's); else the site's first row.
    if (targetType === 'page') {
      const session = await getServerSession(authOptions)
      const where = { adapter, itemId: decodedItemId, targetType: 'page', siteId }
      const item =
        (session?.user?.id
          ? await prisma.userData.findFirst({ where: { ...where, userId: session.user.id } })
          : null) ??
        await prisma.userData.findFirst({ where, orderBy: { createdAt: 'asc' } })

      if (!item) {
        return NextResponse.json({
          adapter,
          itemId: decodedItemId,
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
    }

    // All other requests require authentication
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch data with optional targeting
    const item = await prisma.userData.findFirst({
      where: {
        userId,
        siteId,
        adapter,
        itemId: decodedItemId,
        targetType: targetType || null,
        targetId: targetId || null,
      },
    })

    if (!item) {
      // Return null data for items that don't exist yet - this is expected for
      // quizzes/editors that haven't been interacted with, not an error
      return NextResponse.json({
        adapter,
        itemId: decodedItemId,
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
    const siteId = new URL(request.url).searchParams.get('siteId')
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    // Delete the caller's item on that site if it exists
    await prisma.userData.deleteMany({
      where: {
        userId,
        siteId,
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
