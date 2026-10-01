/**
 * Where a visit to the app's own site came from — campaign label (`?ref=`),
 * UTM parameters, referring domain. Used twice, both deliberately coarse:
 *
 * 1. Anonymous daily counters in the proxy (`visit:*` rows in metric_points):
 *    no IP, no cookie, no id, just "+1 for ref:coldmail-chemie today".
 * 2. First-touch attribution on signup: the browser keeps the source in
 *    localStorage until an account is created, then attaches it once to
 *    that account (src/components/signup-attribution.tsx).
 *
 * Only the referrer's domain is kept, never its path (paths can carry names).
 * Labels are meant per campaign or batch, never per recipient — a label only
 * one person received would make even the counter personal.
 *
 * Edge-safe: imported by the proxy and by client code.
 */

export interface VisitSource {
  ref?: string
  /** `source/medium/campaign`, missing parts as `-` */
  utm?: string
  /** Referring domain without `www.` */
  referrer?: string
}

export const VISIT_METRIC_PREFIX = 'visit:'

const MAX_LABEL_LENGTH = 64

// Login and payment round-trips land back on our pages with these as referrer.
const IGNORED_REFERRER_HOSTS = [
  'login.microsoftonline.com',
  'login.live.com',
  'accounts.google.com',
  'payrexx.com',
]

/** Lowercase, `[a-z0-9._-]` only, capped. Null if nothing usable is left. */
export function sanitizeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const label = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return label ? label.slice(0, MAX_LABEL_LENGTH) : null
}

/** The app's own hosts — a referrer from these is internal navigation. */
export function isOwnHost(host: string): boolean {
  return host === 'eduskript.org' || host.endsWith('.eduskript.org') || host === 'localhost' || host === '127.0.0.1'
}

function referrerDomain(referrer: string | null | undefined): string | null {
  if (!referrer) return null
  let host: string
  try {
    host = new URL(referrer).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host || isOwnHost(host)) return null
  if (IGNORED_REFERRER_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return null
  return sanitizeLabel(host.replace(/^www\./, ''))
}

/** Extract the visit source, or null when the visit carries none. */
export function readVisitSource(url: URL, referrer: string | null | undefined): VisitSource | null {
  const source: VisitSource = {}

  const ref = sanitizeLabel(url.searchParams.get('ref'))
  if (ref) source.ref = ref

  const utmParts = ['utm_source', 'utm_medium', 'utm_campaign'].map(p => sanitizeLabel(url.searchParams.get(p)))
  if (utmParts.some(Boolean)) source.utm = utmParts.map(p => p ?? '-').join('/')

  const domain = referrerDomain(referrer)
  if (domain) source.referrer = domain

  return Object.keys(source).length > 0 ? source : null
}

/** Re-validate a source that came from the client. */
export function sanitizeVisitSource(input: unknown): VisitSource | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const source: VisitSource = {}
  const ref = typeof raw.ref === 'string' ? sanitizeLabel(raw.ref) : null
  if (ref) source.ref = ref
  if (typeof raw.utm === 'string') {
    const parts = raw.utm.split('/').slice(0, 3).map(p => (p === '-' ? '-' : sanitizeLabel(p) ?? '-'))
    if (parts.some(p => p !== '-')) source.utm = parts.join('/')
  }
  const referrer = typeof raw.referrer === 'string' ? sanitizeLabel(raw.referrer) : null
  if (referrer) source.referrer = referrer
  return Object.keys(source).length > 0 ? source : null
}

/** metric_points names for the daily counters, e.g. `visit:ref:coldmail-chemie`. */
export function visitCounterNames(source: VisitSource): string[] {
  const names: string[] = []
  if (source.ref) names.push(`${VISIT_METRIC_PREFIX}ref:${source.ref}`)
  if (source.utm) names.push(`${VISIT_METRIC_PREFIX}utm:${source.utm}`)
  if (source.referrer) names.push(`${VISIT_METRIC_PREFIX}referrer:${source.referrer}`)
  return names
}
