import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite, getManagedSiteIds } from '@/lib/site-access'
import { readSiteTheme } from '@/lib/site-theme'
import { writeSiteTheme } from '@/lib/site-theme-save'

/**
 * POST /api/sites/[siteId]/theme/apply — copy this site's SAVED theme
 * (heading style, body font, navigation, reading progress, custom CSS)
 * onto other sites.
 * Body: { targetSiteIds: string[] }.
 *
 * The caller must manage the source AND every target (personal sites they
 * own, org sites where they are owner/admin — getManagedSiteIds). A single
 * unmanaged target rejects the whole request (403) before anything is
 * written. Writes are sequential, one update + cache bust per target.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { siteId } = await params
    const userId = session.user.id
    if (!(await canManageSite(userId, siteId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const raw: unknown = body?.targetSiteIds
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(id => typeof id === 'string')) {
      return NextResponse.json({ error: 'targetSiteIds must be a non-empty list' }, { status: 400 })
    }
    const targetIds = [...new Set(raw as string[])].filter(id => id !== siteId)
    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'No target sites' }, { status: 400 })
    }

    const managed = new Set(await getManagedSiteIds(userId))
    if (targetIds.some(id => !managed.has(id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const source = await prisma.site.findUnique({
      where: { id: siteId },
      select: { typographyPreference: true, sidebarBehavior: true, extraSettings: true },
    })
    if (!source) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }
    // readSiteTheme re-sanitizes the stored CSS; relative file names were
    // already resolved to absolute file URLs when the source was saved.
    const theme = readSiteTheme(source)
    const settings = {
      preset: theme.preset,
      bodyFont: theme.bodyFont,
      sidebarBehavior: source.sidebarBehavior === 'contextual' ? 'contextual' as const : 'full' as const,
      showReadingProgress: theme.showReadingProgress,
      customCss: theme.customCss,
    }

    for (const id of targetIds) {
      await writeSiteTheme(id, settings)
    }

    return NextResponse.json({ success: true, applied: targetIds.length })
  } catch (error) {
    console.error('Error applying site theme:', error)
    return NextResponse.json({ error: 'Failed to apply theme' }, { status: 500 })
  }
}
