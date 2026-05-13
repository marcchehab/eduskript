import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'

// GET /api/admin/organizations - List all organizations
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const orgsRaw = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        site: { select: { slug: true } },
        createdAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const organizations = orgsRaw.map(({ site, ...o }) => ({ ...o, slug: site?.slug ?? '' }))
    return NextResponse.json({ organizations })
  } catch (error) {
    console.error('Error fetching organizations:', error)
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 })
  }
}
