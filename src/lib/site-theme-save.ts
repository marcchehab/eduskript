/**
 * Write path for site themes: validation, CSS sanitizing with file-name
 * resolution, persistence and cache invalidation. Used by
 * /api/sites/[siteId]/theme (save) and /api/sites/[siteId]/theme/apply
 * (copy to other sites). Read path: src/lib/site-theme.ts.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from './prisma'
import { CACHE_TAGS } from './cached-queries'
import {
  THEME_PRESETS,
  BODY_FONTS,
  CUSTOM_CSS_MAX_LENGTH,
  mergeExtraSettings,
  type ThemePreset,
  type BodyFont,
} from './settings'
import { sanitizeCustomCss, type RemovedCssItem } from './custom-css'
import { customCssOptions } from './site-theme'
import { placedOnSiteWhere } from './site-access'
import { getS3Key } from './file-storage'
import { getTeacherFileUrl } from './s3'

/** Everything the theme editor saves. */
export interface ThemeSettingsInput {
  /** Heading style ('classic' still accepted: legacy Fancy + Garamond). */
  preset: ThemePreset
  /** null = the heading style's default font. */
  bodyFont: BodyFont | null
  sidebarBehavior: 'full' | 'contextual'
  showReadingProgress: boolean
  customCss: string
}

/** Validate a request body. Returns the parsed settings or an error message. */
export function parseThemeSettings(body: unknown): { settings: ThemeSettingsInput } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid body' }
  const b = body as Record<string, unknown>
  if (!(THEME_PRESETS as readonly unknown[]).includes(b.preset)) return { error: 'Invalid theme preset' }
  const bodyFont = b.bodyFont ?? null
  if (bodyFont !== null && !(BODY_FONTS as readonly unknown[]).includes(bodyFont)) return { error: 'Invalid body font' }
  if (b.sidebarBehavior !== 'full' && b.sidebarBehavior !== 'contextual') return { error: 'Invalid navigation value' }
  if (typeof b.showReadingProgress !== 'boolean') return { error: 'Invalid reading progress value' }
  const css = b.customCss ?? ''
  if (typeof css !== 'string') return { error: 'Invalid custom CSS' }
  if (css.length > CUSTOM_CSS_MAX_LENGTH) {
    return { error: `Custom CSS is too long (max ${CUSTOM_CSS_MAX_LENGTH.toLocaleString('en')} characters)` }
  }
  return {
    settings: {
      preset: b.preset as ThemePreset,
      bodyFont: bodyFont as BodyFont | null,
      sidebarBehavior: b.sidebarBehavior,
      showReadingProgress: b.showReadingProgress,
      customCss: css,
    },
  }
}

/**
 * Sanitize custom CSS for storage on `siteId`. Bare file names
 * (`url(bg.png)`) are resolved to the public URL of a file with that name in
 * a skript placed on the site (first match by skript/file creation order if
 * several skripts have one); unresolvable names are removed like any other
 * disallowed URL. One extra query per save, only when relative names occur.
 */
export async function sanitizeCustomCssForSite(
  siteId: string,
  css: string,
): Promise<{ css: string; removed: RemovedCssItem[] }> {
  const options = customCssOptions()
  const first = sanitizeCustomCss(css, options)
  const names = [...new Set(first.removed.filter(r => r.relative).map(r => r.value.replace(/^\.\//, '')))]
  if (names.length === 0) return first

  const files = await prisma.file.findMany({
    where: {
      name: { in: names },
      isDirectory: false,
      hash: { not: null },
      skript: await placedOnSiteWhere(siteId),
    },
    orderBy: [{ skript: { createdAt: 'asc' } }, { createdAt: 'asc' }],
    select: { name: true, hash: true },
  })
  const relativeFiles: Record<string, string> = {}
  for (const f of files) {
    if (relativeFiles[f.name] || !f.hash) continue
    const ext = f.name.split('.').pop() || ''
    relativeFiles[f.name] = getTeacherFileUrl(getS3Key(f.hash, ext))
  }
  return sanitizeCustomCss(css, { ...options, relativeFiles })
}

/** Persist already-validated, already-sanitized settings on one site. */
export async function writeSiteTheme(siteId: string, settings: ThemeSettingsInput) {
  const row = await prisma.site.findUnique({ where: { id: siteId }, select: { extraSettings: true } })
  if (!row) throw new Error('Site not found')
  const css = settings.customCss.trim()
  await prisma.site.update({
    where: { id: siteId },
    data: {
      typographyPreference: settings.preset,
      sidebarBehavior: settings.sidebarBehavior,
      extraSettings: mergeExtraSettings(row.extraSettings, {
        // Only the opt-out is stored; `undefined` deletes the key.
        hideReadingProgress: settings.showReadingProgress ? undefined : true,
        bodyFont: settings.bodyFont ?? undefined,
        customCss: css ? css : undefined,
      }) as object,
    },
  })
  await revalidateSitePresentation(siteId)
}

/**
 * Bust every cache that renders this site's theme/navigation. Same set as
 * the older per-setting routes: the slug-keyed unstable_cache tags read by
 * the [domain] layout and the org-path teacher routes, plus explicit path
 * revalidation for the ISR routes that carry no tag of their own
 * (org/[orgSlug]/[pageSlug]/* and the org site's own pages).
 */
export async function revalidateSitePresentation(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { slug: true, userId: true, organizationId: true },
  })
  if (!site) return

  if (site.organizationId) {
    // org/[orgSlug]/** — 'layout' revalidates every page below it, including
    // org/[orgSlug]/c/* which read the org Site via plain prisma calls.
    revalidatePath(`/org/${site.slug}`, 'layout')
    revalidateTag(CACHE_TAGS.organization(site.slug), { expire: 0 })
    revalidateTag(CACHE_TAGS.orgContent(site.slug), { expire: 0 })
    return
  }

  revalidateTag(CACHE_TAGS.user(site.slug), { expire: 0 })
  revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })
  // The site is also reachable at eduskript.org/<slug> via
  // /org/[orgSlug]/[pageSlug] for each org its owner belongs to.
  if (site.userId) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: site.userId },
      select: { organization: { select: { site: { select: { slug: true } } } } },
    })
    for (const { organization } of memberships) {
      if (organization.site?.slug) {
        revalidatePath(`/org/${organization.site.slug}/${site.slug}`, 'layout')
      }
    }
  }
}
