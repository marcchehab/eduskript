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

    // typographyPreference lives on the user's primary Site.
    const site = await prisma.site.findFirst({
      where: { userId: session.user.id },
      orderBy: PRIMARY_SITE_ORDER,
      select: { typographyPreference: true }
    })

    return NextResponse.json({
      typographyPreference: site?.typographyPreference || 'modern'
    })
  } catch (error) {
    console.error('Error fetching typography preference:', error)
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
    const { typographyPreference } = body

    // Validate the value
    if (!['modern', 'classic'].includes(typographyPreference)) {
      return NextResponse.json(
        { error: 'Invalid typography preference value' },
        { status: 400 }
      )
    }

    // Update on the user's primary Site. A missing Site throws below and
    // surfaces as a 500, matching prior behavior.
    const primary = await prisma.site.findFirst({
      where: { userId: session.user.id },
      orderBy: PRIMARY_SITE_ORDER,
      select: { id: true },
    })
    if (!primary) throw new Error('No site found for user')

    await prisma.site.update({
      where: { id: primary.id },
      data: { typographyPreference }
    })

    return NextResponse.json({
      success: true,
      typographyPreference
    })
  } catch (error) {
    console.error('Error updating typography preference:', error)
    return NextResponse.json(
      { error: 'Failed to update preference' },
      { status: 500 }
    )
  }
}
