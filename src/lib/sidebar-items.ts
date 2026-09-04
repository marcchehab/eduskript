import type { SidebarItem } from '@/components/public/layout'
import {
  getTeacherWithLayout,
  getFullSiteStructure,
  getTeacherHomepageContent,
  getOrgWithLayout,
  getOrgFullSiteStructure,
  getOrgHomepageContent,
} from './cached-queries'

// Builds the interleaved sidebar list (collections + root skripts in
// page-builder order) that PublicSiteLayout renders in "full" mode. One
// shared implementation for the [domain] layout and the org routes so a
// teacher's root skripts appear in the sidebar on eduskript.org/<slug>/...
// exactly as they do on a custom domain. All inputs come from cached queries
// (revalidate:false, tag-invalidated), so calling this from several routes
// costs no extra DB work after the first render.

type PageItemRef = { type: string; contentId: string }

function interleave<
  C extends { id: string },
  S extends { id: string },
>(
  pageItems: PageItemRef[],
  collections: C[],
  rootSkripts: S[]
): Array<{ kind: 'collection'; data: C } | { kind: 'skript'; data: S }> {
  type Item = { kind: 'collection'; data: C } | { kind: 'skript'; data: S }
  return pageItems.flatMap((item): Item[] => {
    if (item.type === 'collection') {
      const col = collections.find(c => c.id === item.contentId)
      return col ? [{ kind: 'collection' as const, data: col }] : []
    }
    if (item.type === 'skript') {
      const sk = rootSkripts.find(s => s.id === item.contentId)
      return sk ? [{ kind: 'skript' as const, data: sk }] : []
    }
    return []
  })
}

/** Full-mode sidebar data for a teacher site (published content only). */
export async function getTeacherSidebarData(teacherId: string, pageSlug: string) {
  const teacher = await getTeacherWithLayout(pageSlug)
  const pageItems = teacher?.pageLayout?.items ?? []
  const [fullSiteStructure, homepageContent] = await Promise.all([
    getFullSiteStructure(teacherId, pageSlug),
    pageItems.length > 0
      ? getTeacherHomepageContent(
          teacherId,
          pageSlug,
          pageItems.map(i => ({ type: i.type, contentId: i.contentId }))
        )
      : null,
  ])
  const rootSkripts = homepageContent?.rootSkripts ?? []
  const sidebarItems: SidebarItem[] = interleave(pageItems, fullSiteStructure, rootSkripts)
  return { sidebarItems, fullSiteStructure, rootSkripts }
}

/** Full-mode sidebar data for an org site (published content only). */
export async function getOrgSidebarData(orgId: string, orgSlug: string) {
  const org = await getOrgWithLayout(orgSlug)
  const pageItems = org?.pageLayout?.items ?? []
  const [fullSiteStructure, homepageContent] = await Promise.all([
    getOrgFullSiteStructure(orgId, orgSlug),
    pageItems.length > 0
      ? getOrgHomepageContent(
          orgId,
          orgSlug,
          pageItems.map(i => ({ type: i.type, contentId: i.contentId }))
        )
      : null,
  ])
  const rootSkripts = homepageContent?.rootSkripts ?? []
  const sidebarItems: SidebarItem[] = interleave(pageItems, fullSiteStructure, rootSkripts)
  return { sidebarItems, fullSiteStructure, rootSkripts }
}
