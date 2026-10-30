/**
 * GET  /api/admin/product-updates/consent-request → { count }
 * POST /api/admin/product-updates/consent-request { expectedCount }
 *
 * Sends the one-time "do you want product updates?" mail to every mailable
 * teacher who hasn't opted in (src/lib/product-updates/service.ts). Admin
 * only. expectedCount must match the current count, so the confirmation the
 * admin saw is the list that gets mailed. Not idempotent — a second POST
 * mails everyone who still hasn't opted in again.
 */
import { after, NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getConsentCandidates, sendConsentRequests } from '@/lib/product-updates/service'

export const maxDuration = 300

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  const candidates = await getConsentCandidates()
  return NextResponse.json({ count: candidates.length })
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error
  const body = await request.json().catch(() => null)
  const candidates = await getConsentCandidates()
  if (body?.expectedCount !== candidates.length) {
    return NextResponse.json({ error: 'Recipient count changed, reload', count: candidates.length }, { status: 409 })
  }
  after(() => sendConsentRequests(candidates))
  return NextResponse.json({ status: 'sending', count: candidates.length })
}
