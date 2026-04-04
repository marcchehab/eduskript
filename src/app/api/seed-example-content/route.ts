import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { seedDemoContent } from '@/lib/seed-demo-content'

// POST /api/seed-example-content - Create demo content for a new teacher
export async function POST() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Guard: only allow for teachers with no existing collections
  const existing = await prisma.collectionAuthor.findFirst({
    where: { userId: session.user.id },
  })

  if (existing) {
    return NextResponse.json(
      { error: 'You already have content. Seed is only available for new accounts.' },
      { status: 400 }
    )
  }

  try {
    const result = await seedDemoContent({
      userId: session.user.id,
      prisma,
    })

    return NextResponse.json({
      success: true,
      data: {
        collectionId: result.collectionId,
        skriptId: result.skriptId,
        layoutId: result.layoutId,
      },
    })
  } catch (error) {
    console.error('Error seeding example content:', error)
    return NextResponse.json(
      { error: 'Failed to create example content' },
      { status: 500 }
    )
  }
}
