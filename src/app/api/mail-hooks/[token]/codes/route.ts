/**
 * GET /api/mail-hooks/[token]/codes — active login codes for a hook.
 *
 * Auth required (logged-in users only, per the access decision). Authorization
 * is "authenticated session + knows the unguessable token" — any signed-in user
 * who can load the page holding <login-codes hook="…"> may read its codes.
 * Tightening to page/owner-scoped access is a possible later step.
 *
 * Response mirrors the old Informatikgarten shape: { codes: [{ code, expiresIn }] }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveCodes } from '@/lib/mail-hooks/store'
import { createLogger } from '@/lib/logger'

const log = createLogger('mail:codes') // enable with DEBUG=mail:*

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await params
  const hook = await prisma.mailHook.findUnique({
    where: { token },
    select: { id: true },
  })
  if (!hook) {
    log.warn('unknown hook token', { token })
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const codes = await getActiveCodes(hook.id)
  log('read', { hookId: hook.id, activeCodes: codes.length })
  return NextResponse.json({ codes })
}
