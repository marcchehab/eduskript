import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin, requireOrgMember } from '@/lib/org-auth'
import { CACHE_TAGS } from '@/lib/cached-queries'

// GET - Get organization's frontpage
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params

    // Check membership (any role can view)
    const { error, session, membership } = await requireOrgMember(orgId)
    if (error) return error

    const frontPage = await prisma.frontPage.findUnique({
      where: { organizationId: orgId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    })

    // Determine if user can edit (admin/owner only)
    const canEdit =
      session?.user?.isAdmin ||
      membership?.role === 'owner' ||
      membership?.role === 'admin'

    return NextResponse.json({
      frontPage: frontPage || null,
      currentVersion: frontPage?.versions[0]?.version || 0,
      canEdit,
    })
  } catch (error) {
    console.error('Error fetching organization frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH - Create or update organization's frontpage
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params

    // Require admin/owner access
    const { error, session } = await requireOrgAdmin(orgId)
    if (error) return error

    const body = await request.json()
    const { content, isPublished } = body

    // Get organization for cache revalidation
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    })

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Get existing frontpage
    const existingFrontPage = await prisma.frontPage.findUnique({
      where: { organizationId: orgId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    })

    let frontPage
    let contentChanged = false

    if (existingFrontPage) {
      // Check if content changed
      const currentVersion = existingFrontPage.versions[0]
      contentChanged = content !== undefined && currentVersion?.content !== content

      // Update existing frontpage
      const updateData: {
        updatedAt: Date
        content?: string
        isPublished?: boolean
      } = {
        updatedAt: new Date(),
      }

      if (content !== undefined) updateData.content = content
      if (isPublished !== undefined) updateData.isPublished = isPublished

      frontPage = await prisma.frontPage.update({
        where: { id: existingFrontPage.id },
        data: updateData,
      })

      // Create new version if content changed
      if (contentChanged && session?.user?.id) {
        await prisma.frontPageVersion.create({
          data: {
            frontPageId: existingFrontPage.id,
            content: content || '',
            version: (currentVersion?.version || 0) + 1,
            authorId: session.user.id,
          },
        })
      }
    } else {
      // Create new frontpage
      frontPage = await prisma.frontPage.create({
        data: {
          organizationId: orgId,
          content: content || '',
          isPublished: isPublished || false,
        },
      })

      // Create initial version
      if (session?.user?.id) {
        await prisma.frontPageVersion.create({
          data: {
            frontPageId: frontPage.id,
            content: content || '',
            version: 1,
            authorId: session.user.id,
          },
        })
      }
      contentChanged = true
    }

    // Revalidate caches — both the data cache (unstable_cache tags) and route cache
    revalidateTag(CACHE_TAGS.organization(organization.slug), { expire: 0 })
    revalidateTag(CACHE_TAGS.orgContent(organization.slug), { expire: 0 })
    revalidatePath(`/org/${organization.slug}`)
    revalidatePath('/dashboard')

    return NextResponse.json({
      frontPage,
      versionCreated: contentChanged,
    })
  } catch (error) {
    console.error('Error updating organization frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
