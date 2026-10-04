import { NextResponse } from 'next/server'
import { getSlugAliasMap } from '@/lib/site-slugs'

// GET - every old site slug → its current slug. Internal API for the proxy's
// old-slug redirects (src/proxy.ts). Served from the Next data cache, so the
// proxy's once-a-minute refresh does not touch the database; see
// getSlugAliasMap in src/lib/site-slugs.ts. Public data anyway: both slugs
// are public URLs.
export async function GET() {
  try {
    return NextResponse.json(await getSlugAliasMap())
  } catch (error) {
    console.error('Error loading slug aliases:', error)
    return NextResponse.json({ error: 'Failed to load slug aliases' }, { status: 500 })
  }
}
