/**
 * Dev-only: revalidate cache tags after editing content directly in the DB
 * (e.g. local content sync scripts). POST { tags: string[] }.
 * Development mode only; no auth because it only drops cache entries.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 })
  }
  const { tags } = (await request.json()) as { tags?: unknown }
  if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) {
    return NextResponse.json({ error: 'tags: string[] required' }, { status: 400 })
  }
  for (const tag of tags) revalidateTag(tag, { expire: 0 })
  return NextResponse.json({ revalidated: tags })
}
