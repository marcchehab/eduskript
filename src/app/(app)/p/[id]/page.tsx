import { notFound, redirect } from 'next/navigation'
import { resolveStableLink } from '@/lib/page-stable-link.server'

// Stable-link redirect route. Authors paste `/p/{pageId}` into markdown;
// public pages get the link rewritten to its canonical URL at compile time
// (see rehype-plugins/stable-page-links.ts), but anything that escapes the
// rewrite — direct shares, client-rendered preview output, edits in transit —
// resolves through here. Unpublished/missing → 404 (don't leak ID existence).

export const dynamic = 'force-dynamic'

interface RouteProps {
  params: Promise<{ id: string }>
}

export default async function StableLinkRedirect({ params }: RouteProps) {
  const { id } = await params
  const resolved = await resolveStableLink(id)
  if (!resolved) notFound()
  redirect(resolved.url)
}
