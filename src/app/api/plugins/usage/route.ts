import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { findPluginUsage } from '@/lib/services/plugins'

/**
 * GET /api/plugins/usage?slugs=a,b — pages that embed the caller's plugins
 * with these slugs: { usage: { [pluginSlug]: [{ title, skriptTitle, … }] } }.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const slugs = (request.nextUrl.searchParams.get('slugs') || '')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
  try {
    const usage = await findPluginUsage(session.user.id, slugs)
    return NextResponse.json({ usage })
  } catch (error) {
    console.error('Failed to look up plugin usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
