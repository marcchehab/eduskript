import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
    const { title, slug, content, isPublished } = body

    // For content-only updates or publish-only updates, title and slug are not required
    const isContentOnlyUpdate = content !== undefined && title === undefined && slug === undefined && isPublished === undefined
    const isPublishOnlyUpdate = isPublished !== undefined && title === undefined && slug === undefined && content === undefined
    
    if (!isContentOnlyUpdate && !isPublishOnlyUpdate && (!title?.trim() || !slug?.trim())) {
      return NextResponse.json(
        { error: 'Title and slug are required' },
        { status: 400 }
      )
    }

    // Check if user is an author of this page
    const existingPage = await prisma.page.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        chapter: {
          include: {
            topic: true
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

    // Check if slug is already used in the same chapter (but not this page)
    // Only check slug conflict if slug is being updated
    if (!isContentOnlyUpdate && !isPublishOnlyUpdate && slug) {
      const slugExists = await prisma.page.findFirst({
        where: {
          slug: slug.trim(),
          chapterId: existingPage.chapterId,
          id: { not: id }
        }
      })

      if (slugExists) {
        return NextResponse.json(
          { error: 'Slug already exists in this chapter' },
          { status: 400 }
        )
      }
    }

    // Check if content has changed to create new version
    const currentVersion = existingPage.versions[0]
    const contentChanged = content !== undefined && currentVersion?.content !== content

    // Prepare update data - only include fields that are provided
    const updateData: {
      updatedAt: Date
      title?: string
      slug?: string
      content?: string
      isPublished?: boolean
    } = {
      updatedAt: new Date()
    }

    if (title !== undefined) updateData.title = title.trim()
    if (slug !== undefined) updateData.slug = slug.trim()
    if (content !== undefined) updateData.content = content
    if (isPublished !== undefined) updateData.isPublished = isPublished

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

    // Revalidate the public page cache for all relevant paths
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (user?.subdomain) {
      // Revalidate the specific page
      revalidatePath(`/${user.subdomain}/${existingPage.chapter.topic?.slug}/${existingPage.chapter.slug}/${updatedPage.slug}`)
      
      // Revalidate the chapter page (in case it lists pages)
      revalidatePath(`/${user.subdomain}/${existingPage.chapter.topic?.slug}/${existingPage.chapter.slug}`)
      
      // Revalidate the topic page (in case it lists chapters/pages)
      revalidatePath(`/${user.subdomain}/${existingPage.chapter.topic?.slug}`)
      
      // Revalidate the home page (in case it lists topics)
      revalidatePath(`/${user.subdomain}`)
      
      // Revalidate dashboard pages
      revalidatePath('/dashboard')
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

    // Check if page exists and user has access
    const existingPage = await prisma.page.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
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

    // Revalidate the topics pages
    revalidatePath('/dashboard/topics')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting page:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
