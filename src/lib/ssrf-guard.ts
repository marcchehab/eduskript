import net from 'node:net'

/**
 * SSRF guard for server-side network probes (see /api/tools/ping).
 *
 * Blocks loopback, private, link-local, CGNAT, multicast and reserved ranges so
 * a user-supplied host can't be steered at internal infrastructure. Handles
 * IPv4, IPv6, and IPv4-mapped IPv6 (::ffff:a.b.c.d).
 *
 * Lives in lib (not the route file) because Next.js route modules may only
 * export handlers + a fixed set of config fields — exporting a helper from
 * route.ts fails the production build's route type-check.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = net.isIPv4(ip) ? ip : null
  if (v4) return isBlockedIPv4(v4)

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    // IPv4-mapped (::ffff:1.2.3.4) — unwrap and check as v4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIPv4(mapped[1])
    if (lower === '::1' || lower === '::') return true // loopback / unspecified
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10 link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 ULA
    if (lower.startsWith('ff')) return true // ff00::/8 multicast
    return false
  }

  return true // unparseable → block
}

function isBlockedIPv4(ip: string): boolean {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = o
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8 private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 168) return true // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a >= 224) return true // 224/4 multicast + 240/4 reserved
  return false
}
