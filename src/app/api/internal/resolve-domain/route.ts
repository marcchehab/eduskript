import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET - Resolve a custom domain to organization or teacher
// This is an internal API used by middleware for domain resolution
// Returns either:
//   { type: 'org', orgId, orgSlug, orgName, isPrimary }
//   { type: 'teacher', userId, pageSlug, userName }
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')

    if (!domain) {
      return NextResponse.json({ error: 'Domain parameter required' }, { status: 400 })
    }

    // Normalize domain
    const normalizedDomain = domain.toLowerCase().trim()

    // Check organization custom domains first
    const customDomain = await prisma.customDomain.findFirst({
      where: {
        domain: normalizedDomain,
        isVerified: true,
      },
      include: {
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    })

    if (customDomain) {
      return NextResponse.json({
        type: 'org',
        orgId: customDomain.organization.id,
        orgSlug: customDomain.organization.slug,
        orgName: customDomain.organization.name,
        isPrimary: customDomain.isPrimary,
      })
    }

    // Check teacher custom domains
    const teacherDomain = await prisma.teacherCustomDomain.findFirst({
      where: {
        domain: normalizedDomain,
        isVerified: true,
      },
      include: {
        user: {
          select: {
            id: true,
            pageSlug: true,
            name: true,
          },
        },
      },
    })

    if (teacherDomain) {
      return NextResponse.json({
        type: 'teacher',
        userId: teacherDomain.user.id,
        pageSlug: teacherDomain.user.pageSlug,
        userName: teacherDomain.user.name,
        isPrimary: teacherDomain.isPrimary,
      })
    }

    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  } catch (error) {
    console.error('Error resolving domain:', error)
    return NextResponse.json({ error: 'Failed to resolve domain' }, { status: 500 })
  }
}
