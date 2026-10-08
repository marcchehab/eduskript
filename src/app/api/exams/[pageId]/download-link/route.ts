import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateExamToken } from '@/lib/exam-tokens'

/**
 * GET /api/exams/[pageId]/download-link
 * Generate a one-time download link for the SEB config
 *
 * This is called by the browser before triggering the sebs:// link,
 * so we can include a download token that SEB can use to fetch the config.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'You must be logged in' },
        { status: 401 }
      )
    }

    // Generate a download token (reuse exam token mechanism)
    const { token } = await generateExamToken(session.user.id, pageId)

    // Build the sebs:// URL with the download token
    const host = request.headers.get('host') || 'eduskript.org'
    // Site scoping: forward the client's site so the config's start URL
    // targets that site's /exam route.
    const siteId = request.nextUrl.searchParams.get('siteId') ?? ''
    const sebsUrl = `sebs://${host}/api/exams/${pageId}/seb-config?download_token=${token}&siteId=${encodeURIComponent(siteId)}`

    return NextResponse.json({ url: sebsUrl })
  } catch (error) {
    console.error('Error generating download link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
