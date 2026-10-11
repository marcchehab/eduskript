/**
 * Server-side initial state for the dashboard theme editor
 * (src/components/dashboard/theme-editor.tsx), shared by
 * /dashboard/site/[siteId]/theme and /dashboard/org/[orgId]/theme.
 *
 * Everything is loaded up front so the editor needs no GET route: the
 * site's settings, every other site the user manages (for "Copy from" /
 * "Apply to"), the pages the live preview can show, and the url() allowlist
 * for client-side CSS sanitizing in the preview.
 */

import { prisma } from './prisma'
import { getManagedSiteIds } from './site-access'
import { readSiteTheme, customCssOptions } from './site-theme'
import { getTeacherSidebarData, getOrgSidebarData } from './sidebar-items'
import type { ThemeSettingsInput } from './site-theme-save'

export interface ThemeEditorSite {
  id: string
  name: string
  kind: 'personal' | 'org'
  settings: ThemeSettingsInput
}

export interface PreviewTarget {
  label: string
  /** Same-origin path of a public page of the site. */
  path: string
}

export interface ThemeEditorData {
  site: ThemeEditorSite
  otherSites: ThemeEditorSite[]
  previewTargets: PreviewTarget[]
  allowedUrlPrefixes: string[]
}

/** Upper bound on preview pages offered in the picker. */
const MAX_PREVIEW_PAGES = 60

/**
 * null when `userId` doesn't manage `siteId` (personal owner / org
 * owner|admin, see getManagedSiteIds) — callers 404.
 */
export async function loadThemeEditorData(userId: string, siteId: string): Promise<ThemeEditorData | null> {
  const managedIds = await getManagedSiteIds(userId)
  if (!managedIds.includes(siteId)) return null

  const rows = await prisma.site.findMany({
    where: { id: { in: managedIds } },
    orderBy: [{ organizationId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      pageName: true,
      userId: true,
      organizationId: true,
      typographyPreference: true,
      sidebarBehavior: true,
      extraSettings: true,
      organization: { select: { name: true } },
    },
  })

  const toEditorSite = (r: (typeof rows)[number]): ThemeEditorSite => {
    const theme = readSiteTheme(r)
    return {
      id: r.id,
      name: r.organization?.name || r.pageName || r.slug,
      kind: r.organizationId ? 'org' : 'personal',
      settings: {
        preset: theme.preset,
        bodyFont: theme.bodyFont,
        sidebarBehavior: r.sidebarBehavior === 'contextual' ? 'contextual' : 'full',
        showReadingProgress: theme.showReadingProgress,
        customCss: theme.customCss,
      },
    }
  }

  const row = rows.find(r => r.id === siteId)
  if (!row) return null

  return {
    site: toEditorSite(row),
    otherSites: rows.filter(r => r.id !== siteId).map(toEditorSite),
    previewTargets: await getPreviewTargets(row),
    allowedUrlPrefixes: [...(customCssOptions().allowedUrlPrefixes ?? [])],
  }
}

/**
 * Published pages of the site, in sidebar order, as same-origin paths:
 * personal sites at /<slug>/… (the path students use on eduskript.org),
 * org sites at /org/<slug>/c/…. Exam pages are skipped (they redirect to
 * the SEB-gated /exam route). The front page is always offered last.
 */
async function getPreviewTargets(site: {
  slug: string
  userId: string | null
  organizationId: string | null
}): Promise<PreviewTarget[]> {
  const isOrg = !!site.organizationId
  const front: PreviewTarget = { label: 'Front page', path: isOrg ? `/org/${site.slug}` : `/${site.slug}` }
  const contentBase = isOrg ? `/org/${site.slug}/c` : `/${site.slug}`

  let items: Awaited<ReturnType<typeof getTeacherSidebarData>>['sidebarItems'] = []
  try {
    if (isOrg) items = (await getOrgSidebarData(site.organizationId!, site.slug)).sidebarItems
    else if (site.userId) items = (await getTeacherSidebarData(site.userId, site.slug)).sidebarItems
  } catch (error) {
    // Preview is best-effort; the editor still works with the front page.
    console.error('Theme editor: failed to load preview pages', error)
  }

  const targets: PreviewTarget[] = []
  const addSkript = (skript: { title: string; slug: string; pages: Array<{ title: string; slug: string; pageType?: string | null }> }) => {
    for (const page of skript.pages) {
      if (targets.length >= MAX_PREVIEW_PAGES) return
      if (page.pageType === 'exam') continue
      targets.push({ label: `${skript.title} › ${page.title}`, path: `${contentBase}/${skript.slug}/${page.slug}` })
    }
  }
  for (const item of items) {
    if (item.kind === 'collection') item.data.skripts.forEach(addSkript)
    else addSkript(item.data)
  }
  return [...targets, front]
}
