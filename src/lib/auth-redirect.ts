/**
 * Centralized authentication redirect utilities
 *
 * This module provides sign-in URL generation based on context.
 * - Main site (/auth/signin) -> teacher sign-in
 * - Teacher pages (/auth/signin?from=pageSlug) -> student/teacher sign-in
 */

/**
 * Generate a sign-in URL with optional teacher page context
 *
 * @param callbackUrl - URL to redirect to after successful sign-in
 * @param fromTeacherPage - Optional pageSlug if signing in from a teacher's page
 * @returns Complete sign-in URL
 */
export function getSignInUrl(
  callbackUrl: string,
  fromTeacherPage?: string
): string {
  const params = new URLSearchParams()

  if (fromTeacherPage) {
    params.set('from', fromTeacherPage)
  }

  params.set('callbackUrl', callbackUrl)

  return `/auth/signin?${params.toString()}`
}

/**
 * Extract pageSlug from a pathname if it's a teacher page
 * Returns undefined for non-teacher pages (auth, dashboard, api, etc.)
 */
export function getTeacherPageSlug(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return undefined

  const firstSegment = segments[0]

  // Skip system routes
  if (['auth', 'dashboard', 'api', '_next'].includes(firstSegment)) {
    return undefined
  }

  return firstSegment
}
