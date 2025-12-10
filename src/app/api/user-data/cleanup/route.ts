/**
 * User Data Cleanup API
 *
 * DELETE /api/user-data/cleanup
 * Removes malformed entries (empty itemId) from the database.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Delete entries with empty itemId
    const result = await prisma.userData.deleteMany({
      where: {
        userId,
        itemId: '',
      },
    })

    return NextResponse.json({
      success: true,
      deletedCount: result.count
    })
  } catch (error) {
    console.error('[user-data/cleanup] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
