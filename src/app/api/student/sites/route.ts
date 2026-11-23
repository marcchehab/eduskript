import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

/**
 * GET /api/student/sites: the sites a student works on, for the "Back to"
 * links in the dashboard sidebar (src/components/dashboard/sidebar.tsx).
 *
 * 1. Sites with the student's own data (user_data.site_id), most recent
 *    activity first.
 * 2. For each teacher of the student's classes on whose sites the student has
 *    no data yet: that teacher's primary site, so a student who just joined
 *    (or signs in on a new device) has a link too.
 *
 * Three queries plus one per teacher without activity (usually 0–2).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const [activity, memberships] = await Promise.all([
    prisma.userData.groupBy({
      by: ['siteId'],
      where: { userId, siteId: { not: '' }, targetType: null },
      _max: { updatedAt: true },
    }),
    prisma.classMembership.findMany({
      where: { studentId: userId, class: { archivedAt: null, isImplicit: false, teacherId: { not: null } } },
      select: { class: { select: { teacherId: true } } },
    }),
  ])

  const select = { id: true, slug: true, pageName: true, pageIcon: true, userId: true } as const
  const activeSites = await prisma.site.findMany({
    where: { id: { in: activity.map((a) => a.siteId) } },
    select,
  })
  const lastActive = new Map(activity.map((a) => [a.siteId, a._max.updatedAt?.getTime() ?? 0]))
  activeSites.sort((a, b) => (lastActive.get(b.id) ?? 0) - (lastActive.get(a.id) ?? 0))

  const teachersWithActivity = new Set(activeSites.map((s) => s.userId))
  const otherTeachers = [...new Set(memberships.map((m) => m.class.teacherId!))].filter(
    (t) => !teachersWithActivity.has(t)
  )
  const defaultSites = await Promise.all(
    otherTeachers.map((teacherId) =>
      prisma.site.findFirst({ where: { userId: teacherId }, orderBy: PRIMARY_SITE_ORDER, select })
    )
  )

  const sites = [...activeSites, ...defaultSites.filter((s) => s !== null)].map(
    ({ id, slug, pageName, pageIcon }) => ({ id, slug, pageName, pageIcon })
  )
  return NextResponse.json({ sites })
}
