/**
 * POST /api/admin/product-updates/[id]  { action: 'send' | 'discard', token }
 *
 * Needs BOTH an admin session and the signed approve token from the preview
 * mail. 'send' claims the draft (pending → sending, once) and mails the
 * recipients after the response via after(), so the request returns at once;
 * the admin page shows progress from sentCount. A second 'send' gets 409.
 */
import { after, NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { approveAndClaim, discardDraft, sendClaimedDraft } from '@/lib/product-updates/service'

// Sending runs inside after(); give it room (25 recipients ≈ 30–60 s).
export const maxDuration = 300

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAdmin()
  if (error) return error
  const { id } = await params
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''

  if (body?.action === 'discard') {
    const ok = await discardDraft(id, token)
    return ok
      ? NextResponse.json({ status: 'discarded' })
      : NextResponse.json({ error: 'Invalid link or draft no longer pending' }, { status: 409 })
  }

  if (body?.action !== 'send') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const claim = await approveAndClaim(id, token, session.user.id)
  if (!claim.ok) {
    const status = claim.reason === 'not-found' ? 404 : claim.reason === 'invalid-token' ? 403 : 409
    return NextResponse.json({ error: claim.reason }, { status })
  }

  after(() => sendClaimedDraft(id, claim.recipients))
  return NextResponse.json({ status: 'sending', recipients: claim.recipients.length })
}
