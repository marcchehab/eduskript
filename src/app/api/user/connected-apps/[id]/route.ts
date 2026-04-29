/**
 * DELETE /api/user/connected-apps/[id] — revoke all tokens for a (user, client)
 * pair. The [id] is the public client_id (e.g. "mcp_…") for the app being
 * revoked, not a token row.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revokeTokensForClient } from '@/lib/mcp/tokens'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  await revokeTokensForClient(session.user.id, clientId)
  return NextResponse.json({ success: true })
}
