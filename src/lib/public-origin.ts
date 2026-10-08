/**
 * Public origin of a request behind a reverse proxy (Caddy, ngrok).
 * request.nextUrl.origin is the server's bind address (e.g. https://0.0.0.0:3000)
 * in the standalone build, so redirects built from it are unreachable.
 */
export function getPublicOrigin(request: { headers: Headers; nextUrl: { origin: string } }): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!host) return request.nextUrl.origin
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
