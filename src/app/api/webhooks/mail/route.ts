/**
 * Inbound-email webhook (CloudMailin → Eduskript).
 *
 * One shared endpoint for the whole platform. Routes a delivered email to the
 * owning teacher's MailHook via the sub-address token (fallback: sourceEmail),
 * runs the hook's mode parser, and stores a MailMessage. Slice 1 surfaces only
 * the "login-code" mode. Public (no session) but gated by a shared secret +
 * per-IP rate limit.
 *
 * CloudMailin POSTs to `/api/webhooks/mail?secret=<CLOUDMAILIN_SECRET>` in
 * either format:
 *   - "Raw Message" (multipart/form-data: `message` = full RFC 822 source,
 *     `envelope[to]`, `envelope[from]`) — required for product updates, whose
 *     DKIM check needs the untouched raw message. Parsed with mailparser.
 *   - "JSON" (legacy; headers/plain/html) — still accepted for login-code
 *     hooks, but product updates arriving this way are rejected.
 *
 * Product updates: a mail to the sub-address token PRODUCT_UPDATE_MAIL_TOKEN
 * (env, no MailHook row) goes to src/lib/product-updates/inbound.ts instead of
 * a MailHook. Related: src/lib/mail-hooks/* and the old single-tenant handler
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
import { simpleParser, type AddressObject } from 'mailparser'
import { handleProductUpdateMail } from '@/lib/product-updates/inbound'

// Enable with DEBUG=mail:* (env in config/deploy.yml, or localStorage in browser — server here).
// log.error always prints; log()/log.warn only when the namespace is enabled.
const log = createLogger('mail:webhook')

// CloudMailin JSON payload (subset we use). Mirrors the old IG handler.
interface CloudMailinPayload {
  envelope?: { from?: string; to?: string }
  headers?: { from?: string; to?: string; subject?: string }
  plain?: string
  html?: string
}

/** Format-independent view of an inbound mail. `raw` only for the Raw format. */
interface InboundMail {
  envTo?: string
  headerTo?: string
  fromAddr: string
  subject?: string
  plain?: string
  html?: string
  raw?: Buffer
}

function addressText(a: AddressObject | AddressObject[] | undefined): string | undefined {
  if (!a) return undefined
  return (Array.isArray(a) ? a : [a]).map((x) => x.text).join(', ') || undefined
}

async function readInbound(request: NextRequest): Promise<InboundMail> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const message = form.get('message')
    // CloudMailin sends `message` as a text field. Decoding it as UTF-8 and
    // back is lossless for 7-bit/QP/base64 and UTF-8 8-bit bodies (what
    // Thunderbird sends); a non-UTF-8 8-bit body would change bytes and fail DKIM.
    const raw =
      typeof message === 'string'
        ? Buffer.from(message, 'utf8')
        : message
          ? Buffer.from(await message.arrayBuffer())
          : Buffer.alloc(0)
    const parsed = await simpleParser(raw)
    const envTo = (form.get('envelope[to]') as string | null) ?? undefined
    const envFrom = (form.get('envelope[from]') as string | null) ?? undefined
    return {
      envTo,
      headerTo: addressText(parsed.to),
      fromAddr: envFrom || parsed.from?.value[0]?.address || 'unknown',
      subject: parsed.subject,
      plain: parsed.text,
      html: typeof parsed.html === 'string' ? parsed.html : undefined,
      raw,
    }
  }

  const payload = (await request.json()) as CloudMailinPayload
  return {
    envTo: payload.envelope?.to,
    headerTo: payload.headers?.to,
    fromAddr: payload.envelope?.from || payload.headers?.from || 'unknown',
    subject: payload.headers?.subject,
    plain: payload.plain,
    html: payload.html,
  }
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
      log.warn('rate-limited')
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter ?? 60) } }
      )
    }

    if (!isAuthorized(request, secret)) {
      log.warn('rejected: bad/missing secret')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const mail = await readInbound(request)
    const { envTo, headerTo, fromAddr } = mail

    const token =
      parseSubAddressToken(envTo) || parseSubAddressToken(headerTo)

    // Product-update drafts: own path, before any MailHook lookup and before
    // logging the subject. Always 200 so CloudMailin never bounces.
    const productToken = process.env.PRODUCT_UPDATE_MAIL_TOKEN
    if (productToken && token && safeEqual(token, productToken)) {
      if (!mail.raw) {
        log.error('product update rejected: CloudMailin format is not "Raw Message"')
        return NextResponse.json({ status: 'ignored', reason: 'raw-format-required' }, { status: 200 })
      }
      const result = await handleProductUpdateMail(mail.raw)
      return NextResponse.json({ status: result.status }, { status: 200 })
    }

    log('received', {
      envTo,
      headerTo,
      from: fromAddr,
      subject: mail.subject,
      hasHtml: !!mail.html,
      hasPlain: !!mail.plain,
    })

    // Route: sub-address token first, then sourceEmail fallback. The fallback
    // is the real path for providers that can't forward to a +token address
    // (e.g. Proton's own forwarding scheme already uses + and =), where the
    // mail lands on the bare CloudMailin address and the original recipient
    // shows up in the To header.
    let hook = token
      ? await prisma.mailHook.findUnique({ where: { token } })
      : null
    let routedBy: 'token' | 'sourceEmail' | null = hook ? 'token' : null

    if (!hook) {
      // Contains-match (not exact) so a "Name <addr>" To header still routes.
      const candidates = [envTo, headerTo]
        .filter((v): v is string => !!v)
        .map((v) => v.toLowerCase())
      if (candidates.length > 0) {
        const sourced = await prisma.mailHook.findMany({
          where: { sourceEmail: { not: null } },
        })
        hook =
          sourced.find(
            (h) =>
              h.sourceEmail &&
              candidates.some((c) => c.includes(h.sourceEmail!.toLowerCase()))
          ) ?? null
        if (hook) routedBy = 'sourceEmail'
      }
    }

    if (!hook) {
      // Return 200, NOT 404: CloudMailin relays the HTTP status as the SMTP
      // reply, so a non-2xx bounces the sender's email. Accept and drop.
      log.warn('no matching hook — accepted + dropped', { token, envTo, headerTo })
      return NextResponse.json({ status: 'ignored', reason: 'no-hook' }, { status: 200 })
    }

    log('routed', { hookId: hook.id, label: hook.label, mode: hook.mode, routedBy })

    const rawMail: RawMail = {
      html: mail.html,
      plain: mail.plain,
      subject: mail.subject,
      from: fromAddr,
    }
    const parser = PARSERS[hook.mode]
    const extracted = parser ? parser(rawMail, hook.parserConfig) : null

    log('parsed', { hookId: hook.id, extracted })

    // For login-code, nothing to store without a code. Return 200 (not 422) so
    // CloudMailin doesn't bounce the mail; log an HTML snippet so the regex can
    // be tuned from the logs (DEBUG=mail:*).
    if (hook.mode === 'login-code' && !extracted) {
      log.warn('no code extracted — accepted + dropped', {
        hookId: hook.id,
        htmlSample: mail.html?.slice(0, 1200),
        // Full-ish plain body: confirmation/verification links (e.g. setting up
        // a Proton→CloudMailin forward) live here and need to be readable from
        // the DEBUG=mail:* logs. Bounded so a huge body can't flood logs.
        plainSample: mail.plain?.slice(0, 8000),
      })
      return NextResponse.json({ status: 'ignored', reason: 'no-code' }, { status: 200 })
    }

    await purgeExpired(hook.id)

    const expiresAt = hook.ttlMinutes
      ? new Date(Date.now() + hook.ttlMinutes * 60 * 1000)
      : null

    const stored = await prisma.mailMessage.create({
      data: {
        hookId: hook.id,
        fromAddr,
        subject: mail.subject ?? null,
        bodyText: mail.plain ?? null,
        bodyHtml: mail.html ?? null,
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
