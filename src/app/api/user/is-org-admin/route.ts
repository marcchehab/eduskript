import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ isOrgAdmin: false })
    }

    // Check if user is an owner or admin of any organization
    const orgAdminMembership = await prisma.organizationMember.findFirst({
      where: {
        userId: session.user.id,
        role: { in: ['owner', 'admin'] },
      },
      select: { id: true },
    })

    return NextResponse.json({ isOrgAdmin: !!orgAdminMembership })
  } catch (error) {
    console.error('Error checking org admin status:', error)
    return NextResponse.json({ isOrgAdmin: false })
  }
}
