/**
 * Inbound-email webhook (CloudMailin → Eduskript).
 *
 * One shared endpoint for the whole platform. Routes a delivered email to the
 * owning teacher's MailHook via the sub-address token (fallback: sourceEmail),
 * runs the hook's mode parser, and stores a MailMessage. Slice 1 surfaces only
 * the "login-code" mode. Public (no session) but gated by a shared secret +
 * per-IP rate limit.
 *
 * CloudMailin must be configured to POST the JSON format to
 * `/api/webhooks/mail?secret=<CLOUDMAILIN_SECRET>`. Related:
 * src/lib/mail-hooks/* and the old single-tenant handler
 * informatikgarten.ch/sites/ig/pages/api/incoming_mails.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { mailWebhookRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { parseSubAddressToken } from '@/lib/mail-hooks/tokens'
import { PARSERS, type RawMail } from '@/lib/mail-hooks/parsers'
import { purgeExpired } from '@/lib/mail-hooks/store'
import { createLogger } from '@/lib/logger'

// Enable with DEBUG=mail:* (env on Koyeb, or localStorage in browser — server here).
// log.error always prints; log()/log.warn only when the namespace is enabled.
const log = createLogger('mail:webhook')

// CloudMailin JSON payload (subset we use). Mirrors the old IG handler.
interface CloudMailinPayload {
  envelope?: { from?: string; to?: string }
  headers?: { from?: string; to?: string; subject?: string }
  plain?: string
  html?: string
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Accept the shared secret via `?secret=` query or the Basic-auth password. */
function isAuthorized(request: NextRequest, secret: string): boolean {
  const q = request.nextUrl.searchParams.get('secret')
  if (q && safeEqual(q, secret)) return true

  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
      const pass = decoded.slice(decoded.indexOf(':') + 1)
      if (safeEqual(pass, secret)) return true
    } catch {
      /* malformed header → unauthorized */
    }
  }
  return false
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.CLOUDMAILIN_SECRET
    // Fail closed: never run an open inbound endpoint.
    if (!secret) {
      console.error('CLOUDMAILIN_SECRET not configured; rejecting mail webhook')
      return NextResponse.json({ error: 'Not configured' }, { status: 503 })
    }

    const rate = mailWebhookRateLimiter.check(getClientIdentifier(request))
    if (!rate.allowed) {
      log.warn('rate-limited', { ip: getClientIdentifier(request) })
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter ?? 60) } }
      )
    }

    if (!isAuthorized(request, secret)) {
      log.warn('rejected: bad/missing secret')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const payload = (await request.json()) as CloudMailinPayload
    const envTo = payload.envelope?.to
    const headerTo = payload.headers?.to
    const fromAddr =
      payload.envelope?.from || payload.headers?.from || 'unknown'

    log('received', {
      envTo,
      headerTo,
      from: fromAddr,
      subject: payload.headers?.subject,
      hasHtml: !!payload.html,
      hasPlain: !!payload.plain,
    })

    // Route: sub-address token first, then sourceEmail fallback.
    const token =
      parseSubAddressToken(envTo) || parseSubAddressToken(headerTo)
    let hook = token
      ? await prisma.mailHook.findUnique({ where: { token } })
      : null
    let routedBy: 'token' | 'sourceEmail' | null = hook ? 'token' : null

    if (!hook) {
      const candidates = [envTo, headerTo]
        .filter((v): v is string => !!v)
        .map((v) => v.toLowerCase())
      if (candidates.length > 0) {
        hook = await prisma.mailHook.findFirst({
          where: { sourceEmail: { in: candidates, mode: 'insensitive' } },
        })
        if (hook) routedBy = 'sourceEmail'
      }
    }

    if (!hook) {
      log.warn('no matching hook', { token, envTo, headerTo })
      return NextResponse.json({ error: 'No matching hook' }, { status: 404 })
    }

    log('routed', { hookId: hook.id, label: hook.label, mode: hook.mode, routedBy })

    const mail: RawMail = {
      html: payload.html,
      plain: payload.plain,
      subject: payload.headers?.subject,
      from: fromAddr,
    }
    const parser = PARSERS[hook.mode]
    const extracted = parser ? parser(mail, hook.parserConfig) : null

    log('parsed', { hookId: hook.id, extracted })

    // For login-code, nothing useful without an extracted code (mirrors the
    // old handler's 422). Persistent modes would store regardless.
    if (hook.mode === 'login-code' && !extracted) {
      log.warn('no code extracted', { hookId: hook.id })
      return NextResponse.json(
        { status: 'error', message: 'No code found in email' },
        { status: 422 }
      )
    }

    await purgeExpired(hook.id)

    const expiresAt = hook.ttlMinutes
      ? new Date(Date.now() + hook.ttlMinutes * 60 * 1000)
      : null

    const stored = await prisma.mailMessage.create({
      data: {
        hookId: hook.id,
        fromAddr,
        subject: payload.headers?.subject ?? null,
        bodyText: payload.plain ?? null,
        bodyHtml: payload.html ?? null,
        extracted: extracted ?? undefined,
        expiresAt,
      },
    })

    log('stored', { messageId: stored.id, hookId: hook.id, expiresAt })

    return NextResponse.json({ status: 'success' }, { status: 200 })
  } catch (error) {
    log.error('Mail webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
