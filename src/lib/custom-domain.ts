/**
 * Server-side custom domain detection.
 *
 * On custom domains (e.g. informatikgarten.ch), the proxy prepends the
 * teacher's pageSlug to all paths. URLs built server-side must omit the
 * pageSlug prefix to avoid double-prefixing.
 */

const MAIN_DOMAINS = ['localhost', 'eduskript.org', 'www.eduskript.org']

/** Check if the given host is a custom domain (not eduskript.org or localhost). */
export function isCustomDomainServer(host: string): boolean {
  const domain = host.split(':')[0] // Strip port
  return !MAIN_DOMAINS.includes(domain)
}

/**
 * Absolute URL on the app's own host for a path that only resolves there.
 *
 * Dashboard links to *another* user's public page (`/<pageSlug>`) break when
 * the dashboard was reached over a custom domain: the proxy prepends that
 * domain owner's slug, so `/evh` on informatikgarten.ch becomes a lookup under
 * Marc's site and 404s. Host-relative hrefs cannot express "this one is on the
 * app host", so those call sites need this.
 *
 * NEXT_PUBLIC_APP_HOSTNAME is baked at build time from NEXTAUTH_URL
 * (next.config.ts), so the value is identical on server and client and this
 * causes no hydration mismatch. Its port is stripped there, hence the
 * localhost/unset escape hatch: in dev we return the path unchanged rather
 * than send the browser to a portless http://localhost. That is also the
 * fallback if a build ever runs without NEXTAUTH_URL — degrading to exactly
 * the host-relative behaviour we had before.
 *
 * Only for cross-user links. Pages under the current tenant must stay
 * relative; see use-public-url.ts.
 */
export function appHostUrl(path: string): string {
  const appHostname = process.env.NEXT_PUBLIC_APP_HOSTNAME
  if (!appHostname || appHostname === 'localhost') return path
  return `https://${appHostname}${path}`
}
