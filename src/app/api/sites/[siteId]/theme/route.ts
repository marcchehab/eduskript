import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canManageSite } from '@/lib/site-access'
import { CUSTOM_CSS_MAX_LENGTH } from '@/lib/settings'
import {
  parseThemeSettings,
  sanitizeCustomCssForSite,
  writeSiteTheme,
} from '@/lib/site-theme-save'

/**
 * PUT /api/sites/[siteId]/theme — save the theme editor's settings (preset,
 * navigation, reading progress, custom CSS) for one site.
 *
 * Who: whoever manages the site's presentation (personal owner, or org
 * owner/admin — canManageSite in src/lib/site-access.ts). The editor page
 * loads its initial state server-side, so there is no GET.
 *
 * Custom CSS is sanitized before storing (src/lib/custom-css.ts); the
 * response returns the stored CSS plus what was removed, so the editor can
 * show it.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { siteId } = await params
    if (!(await canManageSite(session.user.id, siteId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = parseThemeSettings(await request.json().catch(() => null))
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { css, removed } = await sanitizeCustomCssForSite(siteId, parsed.settings.customCss)
    // Sanitizing can lengthen the CSS (quoted url(), `<` → `\3c `), so the
    // cap is checked again on what would be stored.
    if (css.trim().length > CUSTOM_CSS_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Custom CSS is too long after sanitizing (max ${CUSTOM_CSS_MAX_LENGTH.toLocaleString('en')} characters)` },
        { status: 400 },
      )
    }
    const settings = { ...parsed.settings, customCss: css.trim() }
    await writeSiteTheme(siteId, settings)

    return NextResponse.json({ success: true, settings, removed })
  } catch (error) {
    console.error('Error saving site theme:', error)
    return NextResponse.json({ error: 'Failed to save theme' }, { status: 500 })
  }
}
