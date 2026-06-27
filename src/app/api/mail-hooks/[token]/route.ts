/**
 * PATCH  /api/mail-hooks/[token] — edit a hook's label / source email / regex.
 *        The token (routing key + <login-codes hook>) and mode are immutable.
 * DELETE /api/mail-hooks/[token] — delete one of the caller's hooks (cascades
 *        its messages).
 * Both owner-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await params
  const hook = await prisma.mailHook.findUnique({ where: { token } })
  if (!hook || hook.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const body = await request.json()
    const data: Prisma.MailHookUpdateInput = {}

    if (body.label !== undefined) {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label) {
        return NextResponse.json({ error: 'Label cannot be empty' }, { status: 400 })
      }
      data.label = label
    }

    if (body.sourceEmail !== undefined) {
      const sourceEmail = typeof body.sourceEmail === 'string' ? body.sourceEmail.trim() : ''
      data.sourceEmail = sourceEmail || null
    }

    if (body.regex !== undefined) {
      const regex = typeof body.regex === 'string' ? body.regex.trim() : ''
      if (regex) {
        try {
          new RegExp(regex)
        } catch {
          return NextResponse.json({ error: 'Invalid regular expression' }, { status: 400 })
        }
        data.parserConfig = { regex }
      } else {
        data.parserConfig = Prisma.DbNull // clear override → falls back to default
      }
    }

    // Note: `token` and `mode` are intentionally never updated.
    await prisma.mailHook.update({ where: { id: hook.id }, data })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Edit mail hook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await params
  const hook = await prisma.mailHook.findUnique({ where: { token } })
  if (!hook || hook.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.mailHook.delete({ where: { id: hook.id } })
  return NextResponse.json({ success: true })
}
