import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { createLogger } from '@/lib/logger'

const log = createLogger('cache:invalidate')

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { title, slug, content, isPublished, pageType, examSettings } = body

    // For content-only updates or publish-only updates, title and slug are not required
    const isContentOnlyUpdate = content !== undefined && title === undefined && slug === undefined && isPublished === undefined
    const isPublishOnlyUpdate = isPublished !== undefined && title === undefined && slug === undefined && content === undefined
    
    if (!isContentOnlyUpdate && !isPublishOnlyUpdate && (!title?.trim() || !slug?.trim())) {
      return NextResponse.json(
        { error: 'Title and slug are required' },
        { status: 400 }
      )
    }

    // Check if user is an author of this page (admins bypass author check)
    const existingPage = await prisma.page.findFirst({
      where: {
        id,
        ...(session.user.isAdmin ? {} : { authors: { some: { userId: session.user.id } } }),
      },
      include: {
        skript: {
          include: {
            collectionSkripts: {
              include: {
                collection: true
              }
            }
          }
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    if (!existingPage) {
      return NextResponse.json(
        { error: 'Page not found' },
        { status: 404 }
      )
    }

    // Check if slug is already used in the same skript (but not this page)
    // Only check slug conflict if slug is being updated
    if (!isContentOnlyUpdate && !isPublishOnlyUpdate && slug) {
      const slugExists = await prisma.page.findFirst({
        where: {
          slug: slug.trim(),
          skriptId: existingPage.skriptId,
          id: { not: id }
        }
      })

      if (slugExists) {
        return NextResponse.json(
          { error: 'Slug already exists in this skript' },
          { status: 400 }
        )
      }
    }

    // Check if content has changed to create new version
    const currentVersion = existingPage.versions[0]
    const contentChanged = content !== undefined && currentVersion?.content !== content

    // Prepare update data - only include fields that are provided
    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    }

    if (title !== undefined) updateData.title = title.trim()
    if (slug !== undefined) updateData.slug = slug.trim()
    if (content !== undefined) updateData.content = content
    if (isPublished !== undefined) updateData.isPublished = isPublished
    if (pageType !== undefined) updateData.pageType = pageType
    if (examSettings !== undefined) updateData.examSettings = examSettings

    // Update the page
    const updatedPage = await prisma.page.update({
      where: { id },
      data: updateData
    })

    // Create new version if content changed
    if (contentChanged) {
      await prisma.pageVersion.create({
        data: {
          pageId: id,
          content: content || '',
          version: (currentVersion?.version || 0) + 1,
          authorId: session.user.id
        }
      })
    }

    // Revalidate the public page cache using tags
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })

    if (user?.pageSlug) {
      log('Invalidating cache tags', {
        pageSlug: user.pageSlug,
        skriptSlug: existingPage.skript.slug,
        page: updatedPage.slug,
      })
      // Invalidate cached data for this page
      revalidateTag(CACHE_TAGS.pageBySlug(user.pageSlug, existingPage.skript.slug, updatedPage.slug), { expire: 0 })

      // Invalidate skript-level cache (navigation might need updating)
      revalidateTag(CACHE_TAGS.skriptBySlug(user.pageSlug, existingPage.skript.slug), { expire: 0 })

      // Invalidate collection-level cache
      const collectionSlug = existingPage.skript.collectionSkripts[0]?.collection?.slug
      if (collectionSlug) {
        revalidateTag(CACHE_TAGS.collectionBySlug(user.pageSlug, collectionSlug), { expire: 0 })
      }

      // Also revalidate paths for any non-cached renders
      revalidatePath(`/${user.pageSlug}/${existingPage.skript.slug}/${updatedPage.slug}`)

      // Invalidate teacher content cache (for full sidebar, homepage, etc.)
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })

      // Revalidate dashboard pages
      revalidatePath('/dashboard')

      // Revalidate org routes if user belongs to any organizations
      const orgMemberships = await prisma.organizationMember.findMany({
        where: { userId: session.user.id },
        select: { organization: { select: { slug: true } } }
      })
      for (const membership of orgMemberships) {
        revalidateTag(CACHE_TAGS.orgContent(membership.organization.slug), { expire: 0 })
      }
    }

    return NextResponse.json(updatedPage)
  } catch (error) {
    console.error('Error updating page:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
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

    // Check if page exists and user has access (admins bypass author check)
    const existingPage = await prisma.page.findFirst({
      where: {
        id,
        ...(session.user.isAdmin ? {} : { authors: { some: { userId: session.user.id } } }),
      }
    })

    if (!existingPage) {
      return NextResponse.json(
        { error: 'Page not found' },
        { status: 404 }
      )
    }

    // Delete page and all its versions
    await prisma.page.delete({
      where: { id }
    })

    revalidatePath('/dashboard/page-builder')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting page:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
