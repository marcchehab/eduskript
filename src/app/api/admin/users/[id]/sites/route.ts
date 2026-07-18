import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

// Slugs that would collide with app routes. Mirrors the reserved list used at
// signup (see src/lib/auth.ts).
const RESERVED_SLUGS = new Set([
  'auth', 'api', 'dashboard', 'admin', 'org', '_next', 'favicon.ico',
  'robots.txt', 'sitemap.xml', 'terms', 'impressum',
])

/**
 * GET /api/admin/users/[id]/sites — list a user's sites (superadmin only).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const sites = await prisma.site.findMany({
    where: { userId: id },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true, pageName: true, order: true, createdAt: true },
  })
  return NextResponse.json({ sites })
}

/**
 * POST /api/admin/users/[id]/sites — grant an ADDITIONAL site to a user
 * (superadmin only). Extra sites are a special deal, not self-serve; this is
 * the only path that creates a second site for a teacher. Body: { slug,
 * pageName? }. New site sorts after existing ones (order = max + 1).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const rawSlug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  const pageName = typeof body.pageName === 'string' && body.pageName.trim() ? body.pageName.trim() : null

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(rawSlug)) {
    return NextResponse.json(
      { error: 'Slug must be lowercase letters, numbers, and hyphens only' },
      { status: 400 },
    )
  }
  if (RESERVED_SLUGS.has(rawSlug)) {
    return NextResponse.json({ error: 'That slug is reserved' }, { status: 400 })
  }

  // Site.slug is globally unique across all user + org sites.
  const taken = await prisma.site.findUnique({ where: { slug: rawSlug }, select: { id: true } })
  if (taken) {
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
  }

  const maxOrder = await prisma.site.aggregate({
    where: { userId: id },
    _max: { order: true },
  })
  const nextOrder = (maxOrder._max.order ?? -1) + 1

  const site = await prisma.site.create({
    data: { slug: rawSlug, userId: id, pageName, order: nextOrder },
    select: { id: true, slug: true, pageName: true, order: true },
  })

  return NextResponse.json({ site }, { status: 201 })
}
