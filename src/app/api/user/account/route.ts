import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GDPR Article 17 - Right to Erasure (Right to be Forgotten)
 *
 * This endpoint allows users to delete their account and associated data.
 * For students with submissions, we anonymize rather than fully delete
 * to preserve teacher records.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Prevent admins from deleting their own account if they're the last admin
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true }
    })

    if (user?.isAdmin) {
      const adminCount = await prisma.user.count({
        where: { isAdmin: true }
      })

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot delete the last admin account' },
          { status: 400 }
        )
      }
    }

    // Check if user has student submissions
    const submissionCount = await prisma.studentSubmission.count({
      where: { studentId: userId }
    })

    if (submissionCount > 0) {
      // Anonymize submissions instead of deleting them
      // This preserves teacher records while removing student identity
      const timestamp = Date.now()
      await prisma.studentSubmission.updateMany({
        where: { studentId: userId },
        data: {
          studentId: `deleted-${timestamp}`,
          // Keep contentData, grade, feedback for teacher records
        }
      })

      // Also anonymize progress records
      await prisma.studentProgress.deleteMany({
        where: { studentId: userId }
      })
    }

    // Delete the user account
    // Prisma cascade delete will handle:
    // - accounts, sessions (OAuth data)
    // - customDomains
    // - pageVersions
    // - collectionAuthors, skriptAuthors, pageAuthors
    // - collectionSkripts
    // - files
    // - collaborationRequests (sent/received)
    // - collaborations
    // - pageLayout
    // - studentProgress (already deleted above if submissions exist)
    // - studentSubmissions will be orphaned with anonymized IDs

    await prisma.user.delete({
      where: { id: userId }
    })

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
      anonymizedSubmissions: submissionCount,
    })

  } catch (error) {
    console.error('Account deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    )
  }
}

/**
 * Get account information
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Get account stats
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        accountType: true,
        createdAt: true,
        isAdmin: true,
        site: {
          select: {
            _count: { select: { collections: true } },
          },
        },
        _count: {
          select: {
            skriptAuthors: true,
            pageAuthors: true,
            files: true,
            studentProgress: true,
            studentSubmissions: true,
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountType: user.accountType,
        createdAt: user.createdAt,
        isAdmin: user.isAdmin,
      },
      stats: {
        collections: user.site?._count.collections ?? 0,
        skripts: user._count.skriptAuthors,
        pages: user._count.pageAuthors,
        files: user._count.files,
        progress: user._count.studentProgress,
        submissions: user._count.studentSubmissions,
      }
    })

  } catch (error) {
    console.error('Account info error:', error)
    return NextResponse.json(
      { error: 'Failed to get account info' },
      { status: 500 }
    )
  }
}
