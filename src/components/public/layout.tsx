import { headers } from 'next/headers'
import { PublicSiteLayout as PublicSiteLayoutClient } from './layout-client'

type ClientProps = Omit<Parameters<typeof PublicSiteLayoutClient>[0], 'proxyStripPrefix'>

// Server wrapper around PublicSiteLayout. Reads the x-proxy-strip-prefix
// request header (set by src/proxy.ts when it rewrites the URL) and forwards
// it as a prop so the client layout can build links that match the
// browser-visible path. No hostname heuristics in the client — works for any
// org/teacher domain the proxy resolves, including DB-resolved custom domains.
export async function PublicSiteLayout(props: ClientProps) {
  const h = await headers()
  const proxyStripPrefix = h.get('x-proxy-strip-prefix') ?? undefined
  return <PublicSiteLayoutClient {...props} proxyStripPrefix={proxyStripPrefix} />
}
