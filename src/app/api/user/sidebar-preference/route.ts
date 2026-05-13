import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // sidebarBehavior lives on the user's Site.
    const site = await prisma.site.findUnique({
      where: { userId: session.user.id },
      select: { sidebarBehavior: true }
    })

    return NextResponse.json({
      sidebarBehavior: site?.sidebarBehavior || 'full'
    })
  } catch (error) {
    console.error('Error fetching sidebar preference:', error)
    return NextResponse.json(
      { error: 'Failed to fetch preference' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sidebarBehavior } = body

    // Validate the value
    if (!['contextual', 'full'].includes(sidebarBehavior)) {
      return NextResponse.json(
        { error: 'Invalid sidebar behavior value' },
        { status: 400 }
      )
    }

    // Update on the user's Site (the per-page preference).
    await prisma.site.update({
      where: { userId: session.user.id },
      data: { sidebarBehavior }
    })

    return NextResponse.json({ 
      success: true,
      sidebarBehavior 
    })
  } catch (error) {
    console.error('Error updating sidebar preference:', error)
    return NextResponse.json(
      { error: 'Failed to update preference' },
      { status: 500 }
    )
  }
}