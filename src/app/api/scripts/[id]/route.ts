import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const script = await prisma.script.findFirst({
      where: {
        id,
        authorId: session.user.id
      },
      include: {
        chapters: {
          include: {
            pages: {
              orderBy: { order: 'asc' }
            }
          },
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!script) {
      return NextResponse.json(
        { error: 'Script not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(script)
  } catch (error) {
    console.error('Error fetching script:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

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
    const { isPublished, title, description, slug } = body

    // Verify the script belongs to the user
    const existingScript = await prisma.script.findFirst({
      where: {
        id,
        authorId: session.user.id
      }
    })

    if (!existingScript) {
      return NextResponse.json(
        { error: 'Script not found' },
        { status: 404 }
      )
    }

    // Update the script
    const updateData: {
      isPublished?: boolean
      title?: string
      description?: string
      slug?: string
    } = {}
    
    if (typeof isPublished === 'boolean') {
      updateData.isPublished = isPublished
    }
    
    if (title !== undefined) {
      updateData.title = title
    }
    
    if (slug !== undefined) {
      updateData.slug = slug
    }
    
    if (description !== undefined) {
      updateData.description = description
    }

    const updatedScript = await prisma.script.update({
      where: { id },
      data: updateData,
      include: {
        chapters: {
          include: {
            pages: {
              orderBy: { order: 'asc' }
            }
          },
          orderBy: { order: 'asc' }
        }
      }
    })

    return NextResponse.json(updatedScript)
  } catch (error) {
    console.error('Error updating script:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
