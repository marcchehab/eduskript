/**
 * Who can see a page or skript — the rules of the public routes, restated for
 * the dashboard's VisibilityBadge (src/components/dashboard/visibility-badge.tsx).
 *
 * Mirrors, and must be kept in sync with:
 * - getPublishedPage() / getOrgTeacherContentPage() in src/lib/cached-queries.ts:
 *   page and skript need isPublished; isUnlisted is NOT checked (URL works).
 * - The public sidebar (getTeacherHomepageContent, src/lib/page-layout.ts):
 *   only skripts placed in the site's PageLayout (directly or via a placed
 *   collection) and not unlisted show up.
 * - getOrgPublishedPage(): org content additionally REQUIRES placement, so an
 *   unplaced org skript is unreachable (`placementRequired`).
 *
 * Collections and sites have no publish switch; billing does not affect
 * public visibility.
 */

export type VisibilityState = 'public' | 'link-only' | 'hidden'
export type VisibilityLevel = 'page' | 'skript' | 'placement'

export interface VisibilityFlags {
  isPublished: boolean
  isUnlisted?: boolean
}

export interface VisibilityCheck {
  level: VisibilityLevel
  /** ok = fully visible at this level; limited = link only; blocked = nobody. */
  status: 'ok' | 'limited' | 'blocked'
  label: string
  detail?: string
}

export interface VisibilityInput {
  /** Omit when the subject is a skript (page builder, library). */
  page?: VisibilityFlags
  skript: VisibilityFlags
  /** Placed on the site's page (directly or via a placed collection).
   *  Omit when unknown — the placement check is then left out. */
  placed?: boolean
  /** Org layouts: unplaced content is not reachable at all. */
  placementRequired?: boolean
}

function flagCheck(
  level: 'page' | 'skript',
  flags: VisibilityFlags,
  subject: 'page' | 'skript'
): VisibilityCheck {
  const name = level === 'page' ? 'Page' : 'Skript'
  if (!flags.isPublished) {
    return {
      level,
      status: 'blocked',
      label: `${name} is a draft`,
      detail:
        level === 'skript' && subject === 'page'
          ? 'A draft skript hides all its pages, even published ones.'
          : 'Only you and co-authors can open it.',
    }
  }
  if (flags.isUnlisted) {
    return {
      level,
      status: 'limited',
      label: `${name} is unlisted`,
      detail: 'The link works, but it is hidden from the sidebar and search engines.',
    }
  }
  return { level, status: 'ok', label: `${name} is published` }
}

export function getVisibility(input: VisibilityInput): {
  state: VisibilityState
  checks: VisibilityCheck[]
} {
  const subject = input.page ? 'page' : 'skript'
  const checks: VisibilityCheck[] = []
  if (input.page) checks.push(flagCheck('page', input.page, subject))
  checks.push(flagCheck('skript', input.skript, subject))
  if (input.placed !== undefined) {
    checks.push(
      input.placed
        ? { level: 'placement', status: 'ok', label: 'On your page' }
        : input.placementRequired
          ? {
              level: 'placement',
              status: 'blocked',
              label: 'Not on the page',
              detail: 'Organization content is only reachable once it is placed in the Page Builder.',
            }
          : {
              level: 'placement',
              status: 'limited',
              label: 'Not on your page',
              detail:
                'The link works, but students won’t find it in your sidebar. Drag the skript onto your page in the Page Builder.',
            }
    )
  }

  const state: VisibilityState = checks.some((c) => c.status === 'blocked')
    ? 'hidden'
    : checks.some((c) => c.status === 'limited')
      ? 'link-only'
      : 'public'
  return { state, checks }
}
