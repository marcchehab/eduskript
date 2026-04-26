import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildStandaloneEmbedHtml } from '@/lib/plugin-sdk'

interface RouteParams {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

/**
 * GET /embed/[ownerSlug]/[pluginSlug] — chromeless public plugin URL.
 *
 * Serves the plugin's HTML directly as the response body, wrapped only with the
 * standalone plugin SDK (resolves config/theme from URL query params, persists
 * setData via localStorage). No React, no Next.js Providers, no SessionProvider —
 * so no NextAuth cookies get attempted in cross-site iframes (e.g. exam.net).
 *
 * Query params: anything except `theme` and `id` flows through to the plugin's
 * `config`. `theme=light|dark` pins the theme; otherwise prefers-color-scheme is
 * used. `id` namespaces localStorage for setData/getData.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { ownerSlug, pluginSlug } = await params

  const plugin = await prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { pageSlug: ownerSlug } },
    select: { entryHtml: true, name: true },
  })

  if (!plugin) {
    return new NextResponse('Plugin not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new NextResponse(buildStandaloneEmbedHtml(plugin.entryHtml, plugin.name), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short caching so plugin edits propagate quickly while still benefiting from CDN.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
