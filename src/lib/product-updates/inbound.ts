/**
 * Inbound side of product updates: Chris writes the update in Thunderbird and
 * sends it to inbox+<PRODUCT_UPDATE_MAIL_TOKEN>@….cloudmailin.net. The webhook
 * (src/app/api/webhooks/mail/route.ts) hands the raw RFC 822 message here.
 *
 * Gate (both must hold, checked on the raw message by this app, not by
 * CloudMailin):
 *   1. exactly one From address, and it is on PRODUCT_UPDATE_SENDERS
 *      (default marc@eduskript.org, marc@informatikgarten.ch);
 *   2. a passing DKIM signature whose d= equals that From address's domain
 *      and that covers the whole body (no l= truncation).
 * Rejections are logged with the reason and the sender address only — never
 * subject or body.
 *
 * What this does NOT stop: a replay of a genuine, DKIM-signed mail from an
 * allowlisted sender (e.g. one Chris once sent to someone else) to the secret
 * address. That only creates a draft; nothing goes out without the admin
 * approval step.
 */
import { simpleParser } from 'mailparser'
import { dkimVerify } from 'mailauth'
import { createLogger } from '@/lib/logger'
import { createDraft } from './service'

const log = createLogger('product-updates:inbound')

export const DEFAULT_SENDERS = 'marc@eduskript.org,marc@informatikgarten.ch'

export function allowedSenders(): string[] {
  return (process.env.PRODUCT_UPDATE_SENDERS || DEFAULT_SENDERS)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** Subset of mailauth's dkimVerify result this gate reads. */
export interface DkimOutcome {
  headerFrom: string[]
  fromFields: number
  results: Array<{
    signingDomain?: string
    status: { result: string; underSized?: number }
  }>
}

export type DkimVerifier = (raw: Buffer) => Promise<DkimOutcome>

export type SenderCheck = { ok: true; from: string } | { ok: false; reason: string; from?: string }

export async function checkSender(
  raw: Buffer,
  verify: DkimVerifier = dkimVerify as unknown as DkimVerifier
): Promise<SenderCheck> {
  let outcome: DkimOutcome
  try {
    outcome = await verify(raw)
  } catch (error) {
    return { ok: false, reason: `dkim-error: ${(error as Error)?.message ?? String(error)}` }
  }

  if (outcome.fromFields !== 1 || outcome.headerFrom.length !== 1) {
    return { ok: false, reason: 'from-header-not-single' }
  }
  const from = outcome.headerFrom[0].toLowerCase()
  if (!allowedSenders().includes(from)) {
    return { ok: false, reason: 'sender-not-allowed', from }
  }

  const domain = from.slice(from.lastIndexOf('@') + 1)
  const aligned = outcome.results.some(
    (r) =>
      r.status.result === 'pass' &&
      r.signingDomain?.toLowerCase() === domain &&
      !r.status.underSized
  )
  if (!aligned) return { ok: false, reason: 'no-passing-dkim-for-sender-domain', from }

  return { ok: true, from }
}

/**
 * Verify, parse and store a product-update draft, then mail the admin preview.
 * Returns what happened for the webhook's response/log. Never throws for a
 * rejected sender — the webhook must answer 200 so CloudMailin doesn't bounce.
 */
export async function handleProductUpdateMail(
  raw: Buffer,
  verify?: DkimVerifier
): Promise<{ status: 'stored'; draftId: string } | { status: 'rejected'; reason: string }> {
  const check = await checkSender(raw, verify)
  if (!check.ok) {
    log.error('product update rejected', { reason: check.reason, from: check.from })
    return { status: 'rejected', reason: check.reason }
  }

  const parsed = await simpleParser(raw)
  const subject = parsed.subject?.trim()
  const bodyHtml = typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : null
  const bodyText = parsed.text?.trim() ? parsed.text : null
  if (!subject || (!bodyHtml && !bodyText)) {
    log.error('product update rejected', { reason: 'empty-subject-or-body', from: check.from })
    return { status: 'rejected', reason: 'empty-subject-or-body' }
  }

  const draft = await createDraft({ fromAddr: check.from, subject, bodyHtml, bodyText })
  log('product update draft stored', { draftId: draft.id })
  return { status: 'stored', draftId: draft.id }
}
