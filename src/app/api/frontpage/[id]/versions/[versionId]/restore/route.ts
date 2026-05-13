import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkSkriptPermissions } from '@/lib/permissions'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, versionId } = await params

    // Get frontpage and check permissions
    const frontPage = await prisma.frontPage.findUnique({
      where: { id },
      include: {
        site: {
          select: {
            userId: true,
            organizationId: true,
            user: { select: { pageSlug: true } },
            organization: { select: { slug: true } },
          },
        },
        skript: {
          include: {
            authors: { include: { user: true } },
          }
        }
      }
    })

    if (!frontPage) {
      return NextResponse.json({ error: 'Frontpage not found' }, { status: 404 })
    }

    // Check permissions based on owner type
    let canEdit = false
    if (frontPage.site) {
      const orgRoles = frontPage.site.organizationId
        ? await prisma.organizationMember.findMany({
            where: { userId: session.user.id, organizationId: frontPage.site.organizationId },
            select: { organizationId: true, role: true },
          })
        : []
      const isOwner = frontPage.site.userId === session.user.id
      const isOrgEditor = orgRoles.some(r => r.role === 'owner' || r.role === 'admin')
      canEdit = isOwner || isOrgEditor
    } else if (frontPage.skript) {
      const permissions = checkSkriptPermissions(session.user.id, frontPage.skript.authors)
      canEdit = permissions.canEdit
    }

    if (!canEdit) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the version to restore
    const versionToRestore = await prisma.frontPageVersion.findFirst({
      where: {
        id: versionId,
        frontPageId: id
      }
    })

    if (!versionToRestore) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    }

    // Get the latest version number
    const latestVersion = await prisma.frontPageVersion.findFirst({
      where: { frontPageId: id },
      orderBy: { version: 'desc' },
      select: { version: true }
    })
    const newVersionNumber = (latestVersion?.version || 0) + 1

    // Update the frontpage content
    const updatedFrontPage = await prisma.frontPage.update({
      where: { id },
      data: {
        content: versionToRestore.content,
        updatedAt: new Date()
      }
    })

    // Create a new version entry for the restoration
    await prisma.frontPageVersion.create({
      data: {
        frontPageId: id,
        content: versionToRestore.content,
        version: newVersionNumber,
        changeLog: `Restored from version ${versionToRestore.version}`,
        authorId: session.user.id
      }
    })

    // Revalidate caches
    if (frontPage.site?.user?.pageSlug) {
      const slug = frontPage.site.user.pageSlug
      revalidateTag(CACHE_TAGS.teacherContent(slug), { expire: 0 })
      revalidatePath(`/${slug}`)
    } else if (frontPage.site?.organization?.slug) {
      const slug = frontPage.site.organization.slug
      revalidateTag(CACHE_TAGS.organization(slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.orgContent(slug), { expire: 0 })
      revalidatePath(`/org/${slug}`)
    } else if (frontPage.skript) {
      // Skript frontpage
      const skriptOwner = frontPage.skript.authors[0]?.user
      if (skriptOwner) {
        const ownerUser = await prisma.user.findUnique({
          where: { id: skriptOwner.id },
          select: { pageSlug: true }
        })
        if (ownerUser?.pageSlug) {
          revalidateTag(CACHE_TAGS.skriptBySlug(ownerUser.pageSlug, frontPage.skript.slug), { expire: 0 })
          revalidatePath(`/${ownerUser.pageSlug}/${frontPage.skript.slug}`)
        }
      }
    }

    revalidatePath('/dashboard')

    return NextResponse.json({
      success: true,
      frontPage: updatedFrontPage,
      restoredFromVersion: versionToRestore.version
    })
  } catch (error) {
    console.error('Error restoring frontpage version:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
