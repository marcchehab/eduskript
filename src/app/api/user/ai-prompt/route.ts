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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { aiSystemPrompt: true }
    })

    return NextResponse.json({
      aiSystemPrompt: user?.aiSystemPrompt || ''
    })
  } catch (error) {
    console.error('Error fetching AI prompt:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI prompt' },
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
    const { aiSystemPrompt } = body

    // Update the user's AI prompt
    await prisma.user.update({
      where: { id: session.user.id },
      data: { aiSystemPrompt: aiSystemPrompt || null }
    })

    return NextResponse.json({
      success: true,
      aiSystemPrompt: aiSystemPrompt || ''
    })
  } catch (error) {
    console.error('Error updating AI prompt:', error)
    return NextResponse.json(
      { error: 'Failed to update AI prompt' },
      { status: 500 }
    )
  }
}
