import type { MetadataRoute } from 'next'
import { getCurrentTenant } from '@/lib/tenant'

// Per-host robots.txt. Both eduskript.org and informatikgarten.ch run the same
// Next.js app, so the sitemap URL must reflect the request host or Googlebot
// will follow a cross-domain sitemap and ignore it.
//
// `headers()` makes this route dynamic, which is what we want — it must run
// per request, not at build time.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getCurrentTenant()
  const baseUrl = `https://${tenant.host}`

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/auth/', '/exam/', '/exam-complete/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
