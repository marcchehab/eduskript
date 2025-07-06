import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    // Get the version to restore
    const versionToRestore = await prisma.pageVersion.findFirst({
      where: {
        id: versionId,
        pageId: id,
        authorId: session.user.id
      }
    })

    if (!versionToRestore) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      )
    }

    // Get the page with current versions
    const page = await prisma.page.findFirst({
      where: {
        id,
        authorId: session.user.id
      },
      include: {
        chapter: {
          include: {
            script: true
          }
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found' },
        { status: 404 }
      )
    }

    const currentVersion = page.versions[0]
    const newVersionNumber = (currentVersion?.version || 0) + 1

    // Update the page content
    const updatedPage = await prisma.page.update({
      where: { id },
      data: {
        content: versionToRestore.content,
        updatedAt: new Date()
      }
    })

    // Create a new version entry for the restoration
    await prisma.pageVersion.create({
      data: {
        pageId: id,
        content: versionToRestore.content,
        version: newVersionNumber,
        changeLog: `Restored from version ${versionToRestore.version}`,
        authorId: session.user.id
      }
    })

    // Revalidate the public page cache
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (user?.subdomain && page.chapter.script) {
      // Revalidate all relevant paths
      revalidatePath(`/${user.subdomain}/${page.chapter.script.slug}/${page.chapter.slug}/${page.slug}`)
      revalidatePath(`/${user.subdomain}/${page.chapter.script.slug}/${page.chapter.slug}`)
      revalidatePath(`/${user.subdomain}/${page.chapter.script.slug}`)
      revalidatePath(`/${user.subdomain}`)
      revalidatePath('/dashboard/scripts')
    }

    return NextResponse.json({ 
      success: true, 
      page: updatedPage,
      restoredFromVersion: versionToRestore.version
    })
  } catch (error) {
    console.error('Error restoring version:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
