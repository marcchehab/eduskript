import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generatePseudonym } from '@/lib/privacy/pseudonym'

/**
 * POST /api/user/convert-to-student
 *
 * Converts the current user's account from teacher to student.
 * Used as an escape hatch on the complete-profile page for users
 * who accidentally ended up in the teacher signup flow.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, accountType: true, email: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (user.accountType === 'student') {
    return NextResponse.json({ message: 'Already a student account' })
  }

  const pseudonym = user.email ? generatePseudonym(user.email) : null
  const anonymousName = `Student ${Math.random().toString(36).substring(2, 6)}`

  // Convert to student and drop the teacher's Site (slug + display fields)
  // so that pageSlug is freed up for another user to claim.
  await prisma.$transaction(async (tx) => {
    await tx.site.deleteMany({ where: { userId: user.id } })
    await tx.user.update({
      where: { id: user.id },
      data: {
        accountType: 'student',
        studentPseudonym: pseudonym,
        name: anonymousName,
        needsProfileCompletion: false,
      },
    })
    // Page-display fields (pageName, pageDescription, …) all live on Site,
    // and the Site was just deleted above — so they're gone for free.
  })

  return NextResponse.json({ message: 'Account converted to student' })
}
