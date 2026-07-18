import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // aiSystemPrompt lives on the user's primary Site.
    const site = await prisma.site.findFirst({
      where: { userId: session.user.id },
      orderBy: PRIMARY_SITE_ORDER,
      select: { aiSystemPrompt: true }
    })

    return NextResponse.json({
      aiSystemPrompt: site?.aiSystemPrompt || ''
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

    // Update on the user's primary Site. Teachers always have a Site by this
    // point; a missing Site means a misconfigured account so we surface a 404.
    const primary = await prisma.site.findFirst({
      where: { userId: session.user.id },
      orderBy: PRIMARY_SITE_ORDER,
      select: { id: true },
    })

    if (!primary) {
      return NextResponse.json(
        { error: 'No public page found for this account' },
        { status: 404 },
      )
    }

    const updated = await prisma.site.update({
      where: { id: primary.id },
      data: { aiSystemPrompt: aiSystemPrompt || null },
      select: { aiSystemPrompt: true },
    }).catch(() => null)

    if (!updated) {
      return NextResponse.json(
        { error: 'No public page found for this account' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      aiSystemPrompt: updated.aiSystemPrompt || ''
    })
  } catch (error) {
    console.error('Error updating AI prompt:', error)
    return NextResponse.json(
      { error: 'Failed to update AI prompt' },
      { status: 500 }
    )
  }
}
