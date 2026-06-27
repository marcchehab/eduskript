/**
 * GET  /api/mail-hooks — list the signed-in teacher's inbound-email hooks.
 * POST /api/mail-hooks — create a hook (mints an unguessable sub-address token).
 *
 * Slice 1 only supports mode="login-code". See src/lib/mail-hooks/*.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateToken, buildSubAddress } from '@/lib/mail-hooks/tokens'
import {
  MAIL_HOOK_MODES,
  MODE_DEFAULT_TTL_MINUTES,
  type MailHookMode,
} from '@/lib/mail-hooks/constants'

function serialize(hook: {
  id: string
  token: string
  label: string
  mode: string
  parserConfig: unknown
  sourceEmail: string | null
  ttlMinutes: number | null
  createdAt: Date
}) {
  const base = process.env.CLOUDMAILIN_INBOX_ADDRESS
  const regex =
    hook.parserConfig &&
    typeof hook.parserConfig === 'object' &&
    'regex' in hook.parserConfig
      ? String((hook.parserConfig as { regex?: unknown }).regex ?? '')
      : ''
  return {
    id: hook.id,
    token: hook.token,
    label: hook.label,
    mode: hook.mode,
    regex,
    sourceEmail: hook.sourceEmail,
    ttlMinutes: hook.ttlMinutes,
    createdAt: hook.createdAt.toISOString(),
    // null when CLOUDMAILIN_INBOX_ADDRESS is unset — UI surfaces a hint.
    forwardingAddress: base ? buildSubAddress(base, hook.token) : null,
    // Bare address for providers that can't forward to a +token (e.g. Proton);
    // those route via sourceEmail instead.
    baseAddress: base ?? null,
    snippet: `<login-codes hook="${hook.token}" />`,
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hooks = await prisma.mailHook.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ hooks: hooks.map(serialize) })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const mode = (typeof body.mode === 'string' ? body.mode : 'login-code') as MailHookMode
    const regex = typeof body.regex === 'string' ? body.regex.trim() : ''
    const sourceEmail =
      typeof body.sourceEmail === 'string' ? body.sourceEmail.trim() : ''

    if (!label) {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 })
    }
    if (!MAIL_HOOK_MODES.includes(mode)) {
      return NextResponse.json({ error: 'Unsupported mode' }, { status: 400 })
    }
    if (regex) {
      // Reject a regex that won't compile rather than storing a dud override.
      try {
        new RegExp(regex)
      } catch {
        return NextResponse.json(
          { error: 'Invalid regular expression' },
          { status: 400 }
        )
      }
    }

    const hook = await prisma.mailHook.create({
      data: {
        userId: session.user.id,
        token: generateToken(),
        label,
        mode,
        parserConfig: regex ? { regex } : undefined,
        sourceEmail: sourceEmail || null,
        ttlMinutes: MODE_DEFAULT_TTL_MINUTES[mode] ?? null,
      },
    })

    return NextResponse.json({ hook: serialize(hook) }, { status: 201 })
  } catch (error) {
    console.error('Create mail hook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
