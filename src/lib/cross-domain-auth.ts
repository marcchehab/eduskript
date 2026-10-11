/**
 * Shared guards for the cross-domain login hand-off
 * (src/app/api/auth/cross-domain/route.ts → .../cross-domain-callback).
 */

/**
 * Dev tunnel hosts (ngrok). They are not in the DB, so the hand-off carries
 * the encoded JWT directly instead of a one-time token. `host` may include a
 * port and a leading www.
 */
export function isTunnelDomain(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
  return h.endsWith('.ngrok-free.dev') || h.endsWith('.ngrok-free.app') || h.endsWith('.ngrok.io')
}

/**
 * Only same-host relative paths may be redirect targets: must start with a
 * single `/` (not `//` or `/\`, which browsers treat as protocol-relative)
 * and contain no control characters or backslashes. Anything else → '/'.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/')) return '/'
  if (value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/'
  return value
}
