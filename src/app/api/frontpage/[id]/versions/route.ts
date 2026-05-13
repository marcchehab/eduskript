import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'

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

    // Get frontpage and check permissions. Site-level frontpages authorise
    // via Site ownership; skript frontpages via SkriptAuthor.
    const frontPage = await prisma.frontPage.findUnique({
      where: { id },
      include: {
        site: { select: { userId: true, organizationId: true } },
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

    if (frontPage.site) {
      const orgRoles = frontPage.site.organizationId
        ? await prisma.organizationMember.findMany({
            where: { userId: session.user.id, organizationId: frontPage.site.organizationId },
            select: { organizationId: true, role: true },
          })
        : []
      const isOwner = frontPage.site.userId === session.user.id
      const isOrgEditor = orgRoles.some(r => r.role === 'owner' || r.role === 'admin')
      if (!isOwner && !isOrgEditor) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (frontPage.skript) {
      const permissions = checkSkriptPermissions(session.user.id, frontPage.skript.authors)
      if (!permissions.canView) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Get all versions
    const versions = await prisma.frontPageVersion.findMany({
      where: { frontPageId: id },
      include: {
        author: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { version: 'desc' }
    })

    return NextResponse.json({ versions })
  } catch (error) {
    console.error('Error fetching frontpage versions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
