import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

/**
 * GET /api/user/sites — the authenticated user's own sites, ordered for the
 * dashboard sidebar (primary first). A teacher normally has exactly one;
 * superadmin-granted extra sites sort after it. Org sites are NOT included
 * here — those come from /api/user/organizations.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true, pageName: true, pageIcon: true, order: true },
  })

  return NextResponse.json({ sites })
}
