/**
 * Single checkpoint fetch — returns the full payload.
 *
 * GET /api/user-data/checkpoints/[id]
 *
 * Authorization (site scoping, src/lib/site-access.ts): caller can read their
 * own checkpoints; anyone else must manage the site the checkpoint was taken
 * on (personal owner / org owner+admin). Legacy rows with siteId '' (skript
 * placed nowhere at migration time) are readable by their owner only. No
 * superadmin bypass; authorship grants nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite } from '@/lib/site-access'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const checkpoint = await prisma.userDataCheckpoint.findUnique({
      where: { id },
    })
    if (!checkpoint) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (checkpoint.userId !== session.user.id) {
      if (!checkpoint.siteId || !(await canManageSite(session.user.id, checkpoint.siteId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    return NextResponse.json({ checkpoint })
  } catch (error) {
    console.error('[checkpoints/:id] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch checkpoint' }, { status: 500 })
  }
}
