/**
 * Per-site theme: what the public layout needs to render a site's pages.
 *
 * Stored on the Site (presentation belongs to the site, see
 * src/lib/site-access.ts):
 *   - preset            → Site.typographyPreference (column, see settings.ts)
 *   - navigation        → Site.sidebarBehavior (column; not part of SiteTheme
 *                          because every route already reads it separately)
 *   - reading progress  → Site.extraSettings.hideReadingProgress (opt-out)
 *   - custom CSS        → Site.extraSettings.customCss (sanitized)
 *
 * Server-only: the url() allowlist for custom CSS comes from the S3 env vars.
 * Edited in the dashboard theme editor (src/components/dashboard/theme-editor.tsx),
 * saved via /api/sites/[siteId]/theme.
 */

import { readExtraSettings, parseThemePreset, type ThemePreset } from './settings'
import { sanitizeCustomCss, type CustomCssOptions } from './custom-css'
import { getTeacherFilesUrlPrefix } from './s3'

export interface SiteTheme {
  preset: ThemePreset
  showReadingProgress: boolean
  /** Sanitized; '' when none. Safe to put inside a <style> element. */
  customCss: string
}

export const DEFAULT_SITE_THEME: SiteTheme = {
  preset: 'modern',
  showReadingProgress: true,
  customCss: '',
}

/** The url() allowlist for custom CSS on this deployment. */
export function customCssOptions(): CustomCssOptions {
  const prefix = getTeacherFilesUrlPrefix()
  return { allowedUrlPrefixes: prefix ? [prefix] : [] }
}

/**
 * Read a site's theme off a Site row (or anything carrying its
 * typographyPreference + extraSettings). Custom CSS is re-sanitized here on
 * every call — the stored value was sanitized on save, this is the
 * render-side second pass. O(css length); cheap next to a page render.
 */
export function readSiteTheme(
  // Both keys required so a caller whose select forgot one fails type-check
  // instead of silently rendering the default theme.
  site: { typographyPreference: string | null; extraSettings: unknown } | null | undefined,
): SiteTheme {
  if (!site) return DEFAULT_SITE_THEME
  const extra = readExtraSettings(site)
  return {
    preset: parseThemePreset(site.typographyPreference),
    showReadingProgress: !extra.hideReadingProgress,
    customCss: extra.customCss ? sanitizeCustomCss(extra.customCss, customCssOptions()).css : '',
  }
}
