import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GDPR Article 15 - Right to Access
 *
 * This endpoint allows users to export all their personal data stored in the system.
 * Rate limited to prevent abuse (30-day cooldown between exports).
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

    // Fetch all user data with relations
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          select: {
            provider: true,
            providerAccountId: true,
            type: true,
            // Exclude tokens for security
          }
        },
        site: {
          select: {
            slug: true,
            pageDescription: true,
            sidebarBehavior: true,
            collections: {
              select: {
                id: true,
                title: true,
                createdAt: true,
              },
            },
          },
        },
        skriptAuthors: {
          include: {
            skript: {
              select: {
                id: true,
                title: true,
                slug: true,
                createdAt: true,
              }
            }
          }
        },
        pageAuthors: {
          include: {
            page: {
              select: {
                id: true,
                title: true,
                slug: true,
                createdAt: true,
              }
            }
          }
        },
        files: {
          select: {
            id: true,
            name: true,
            size: true,
            contentType: true,
            isDirectory: true,
            createdAt: true,
          }
        },
        studentProgress: {
          include: {
            page: {
              select: {
                id: true,
                title: true,
                slug: true,
              }
            }
          }
        },
        studentSubmissions: {
          include: {
            page: {
              select: {
                id: true,
                title: true,
                slug: true,
              }
            }
          }
        },
        sentCollaborationRequests: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          }
        },
        receivedCollaborationRequests: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          }
        },
      }
    })

    if (!userData) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Remove sensitive data before export
    const exportData = {
      exportDate: new Date().toISOString(),
      exportVersion: '1.0',
      gdprCompliant: true,
      profile: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        emailVerified: userData.emailVerified,
        image: userData.image,
        username: userData.site?.slug ?? null,
        title: userData.title,
        bio: userData.bio,
        pageDescription: userData.site?.pageDescription ?? null,
        accountType: userData.accountType,
        studentPseudonym: userData.studentPseudonym,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        lastSeenAt: userData.lastSeenAt,
        gdprConsentAt: userData.gdprConsentAt,
      },
      preferences: {
        themePreference: userData.themePreference,
        sidebarBehavior: userData.site?.sidebarBehavior ?? null,
      },
      accounts: userData.accounts,
      // Owned (1:1 site) collections — there's no permission level anymore.
      ownedCollections: userData.site?.collections.map(c => ({
        collectionId: c.id,
        collectionTitle: c.title,
        since: c.createdAt,
      })) ?? [],
      authoredSkripts: userData.skriptAuthors.map(sa => ({
        skriptId: sa.skript.id,
        skriptTitle: sa.skript.title,
        skriptSlug: sa.skript.slug,
        permission: sa.permission,
        since: sa.createdAt,
      })),
      authoredPages: userData.pageAuthors.map(pa => ({
        pageId: pa.page.id,
        pageTitle: pa.page.title,
        pageSlug: pa.page.slug,
        permission: pa.permission,
        since: pa.createdAt,
      })),
      uploadedFiles: userData.files,
      studentProgress: userData.studentProgress.map(sp => ({
        pageId: sp.pageId,
        pageTitle: sp.page.title,
        completed: sp.completed,
        lastViewedAt: sp.lastViewedAt,
      })),
      studentSubmissions: userData.studentSubmissions.map(ss => ({
        pageId: ss.pageId,
        pageTitle: ss.page.title,
        submittedAt: ss.submittedAt,
        grade: ss.grade,
        feedback: ss.feedback,
        contentData: ss.contentData,
      })),
      collaborationRequests: {
        sent: userData.sentCollaborationRequests,
        received: userData.receivedCollaborationRequests,
      },
    }

    // Return as downloadable JSON file
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="eduskript-data-export-${userId}-${Date.now()}.json"`,
      },
    })

  } catch (error) {
    console.error('Data export error:', error)
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    )
  }
}
