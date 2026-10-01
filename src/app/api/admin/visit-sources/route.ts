import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { VISIT_METRIC_PREFIX } from '@/lib/visit-source'

/**
 * GET /api/admin/visit-sources?days=30
 *
 * Visit-source counters (anonymous, from the proxy) summed over the window,
 * plus the teacher signups in that window and the source each brought along.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days')) || 30, 1), 365)
  const since = new Date(Date.now() - days * 86400000)

  const [counters, signups] = await Promise.all([
    prisma.metricPoint.groupBy({
      by: ['name'],
      where: { name: { startsWith: VISIT_METRIC_PREFIX }, timestamp: { gte: since } },
      _sum: { count: true },
    }),
    prisma.user.findMany({
      where: { accountType: 'teacher', createdAt: { gte: since } },
      select: { email: true, name: true, createdAt: true, signupSource: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const visits = counters
    .map(c => {
      const [kind, ...label] = c.name.slice(VISIT_METRIC_PREFIX.length).split(':')
      return { kind, label: label.join(':'), count: c._sum.count ?? 0 }
    })
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    days,
    visits,
    signups,
  })
}
