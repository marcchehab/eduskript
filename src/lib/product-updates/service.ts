/**
 * Product-update mailing: draft storage, admin approval, sending, opt-in/out.
 *
 * Flow: inbound.ts stores a draft (createDraft) → admins get a preview mail
 * with a signed approve link → /dashboard/admin/product-updates/[id] (admin
 * login required) shows "Send to N recipients" → approveAndClaim flips the
 * draft pending → sending exactly once → sendClaimedDraft mails each recipient
 * individually (no BCC), sequentially with a pause, from
 * Marc Chéhab <marc@eduskript.org>, each with their own unsubscribe link and
 * List-Unsubscribe headers.
 *
 * Recipients: opted-in teachers plus confirmed guest subscribers (no account,
 * double opt-in via the <newsletter /> block), deduplicated by lowercased
 * email — the teacher entry wins, so its unsubscribe link (which also deletes
 * a guest row with the same address, see setProductUpdates) is the one sent.
 *
 * Volume: Infomaniak allows 200 recipients / 24 h for the SMTP account, shared
 * with transactional mail. Nothing here enforces that; with ~25 teachers it
 * is far away. A crash mid-send leaves the draft in "sending" with sentCount
 * showing how far it got — there is no resume (a re-send would double-mail
 * the first sentCount recipients).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendEmail, getAdminNotificationRecipients } from '@/lib/email'
import { createLogger } from '@/lib/logger'
import { signApproveToken, signUserToken, verifyApproveToken } from './tokens'
import {
  PRODUCT_UPDATE_FROM,
  PRODUCT_UPDATE_REPLY_TO,
  baseUrl,
  escapeHtml,
  injectAfterBodyStart,
  languageForSites,
  listUnsubscribeHeaders,
  renderProductUpdate,
  unsubscribePageUrl,
  type MailLanguage,
} from './render'

const log = createLogger('product-updates')

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000
/** Pause between two recipients. ~25 teachers → well under a minute. */
export const SEND_DELAY_MS = 1000

export interface Recipient {
  /** User id, or ProductUpdateSubscriber id when kind is 'guest'. */
  id: string
  email: string
  name: string | null
  lang: MailLanguage
  kind: 'user' | 'guest'
}

/** Unconfirmed guest subscriptions are deleted after this long. */
export const GUEST_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Teachers we may mail at all: real address, not a temporary exam account,
 * and the address is proven — verified (password signups can't log in
 * before that) or OAuth (no password; the provider vouches for the address).
 */
function mailableTeacherWhere(extra: Prisma.UserWhereInput): Prisma.UserWhereInput {
  return {
    accountType: 'teacher',
    isTemporary: false,
    AND: [
      { email: { not: null } },
      { NOT: { email: { endsWith: '@eduskript.local' } } },
      { OR: [{ emailVerified: { not: null } }, { hashedPassword: null }] },
      extra,
    ],
  }
}

async function findTeachers(extra: Prisma.UserWhereInput): Promise<Recipient[]> {
  const users = await prisma.user.findMany({
    where: mailableTeacherWhere(extra),
    select: { id: true, email: true, name: true, sites: { select: { pageLanguage: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return users.map((u) => ({
    id: u.id,
    email: u.email!,
    name: u.name,
    lang: languageForSites(u.sites),
    kind: 'user' as const,
  }))
}

/** First occurrence per lowercased email wins. O(n). */
export function dedupeRecipients(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>()
  return recipients.filter((r) => {
    const key = r.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Opted-in teachers, then confirmed guest subscribers, deduplicated by email
 * (teachers first, so a teacher who also has a guest row is mailed as the
 * teacher). Read fresh at send time.
 */
export async function getRecipients(): Promise<Recipient[]> {
  const [teachers, guests] = await Promise.all([
    findTeachers({ productUpdates: true }),
    prisma.productUpdateSubscriber.findMany({
      where: { confirmedAt: { not: null } },
      select: { id: true, email: true, lang: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  return dedupeRecipients([
    ...teachers,
    ...guests.map((g) => ({
      id: g.id,
      email: g.email,
      name: null,
      lang: (g.lang === 'de' ? 'de' : 'en') as MailLanguage,
      kind: 'guest' as const,
    })),
  ])
}

// ---------------------------------------------------------------- opt-in/out

/**
 * Set a user's product-update preference. Opt-in stamps the consent time;
 * opt-out clears both and also deletes a guest subscription with the user's
 * address, so one unsubscribe click stops all product mail to that address.
 * Returns false if the user doesn't exist.
 */
export async function setProductUpdates(userId: string, enabled: boolean): Promise<boolean> {
  const res = await prisma.user.updateMany({
    where: { id: userId },
    data: { productUpdates: enabled, productUpdatesConsentAt: enabled ? new Date() : null },
  })
  if (res.count !== 1) return false
  if (!enabled) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (user?.email) {
      await prisma.productUpdateSubscriber.deleteMany({ where: { email: user.email.toLowerCase() } })
    }
  }
  return true
}

// ------------------------------------------------- guests (no account, DOI)

/** Lazy cleanup, called on guest signup and before sending. */
export async function purgeUnconfirmedGuests(now = new Date()): Promise<void> {
  await prisma.productUpdateSubscriber.deleteMany({
    where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - GUEST_CONFIRM_TTL_MS) } },
  })
}

function guestConfirmMail(lang: MailLanguage, confirmUrl: string) {
  const url = escapeHtml(confirmUrl)
  const button = (label: string) =>
    `<p style="margin:24px 0;"><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">${label}</a></p>`
  const wrap = (body: string) => `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;">${body}</div>`
  if (lang === 'de') {
    return {
      subject: 'Anmeldung bestätigen: Produkt-Updates von Eduskript',
      html: wrap(`<p>Hallo</p>
<p>Jemand, hoffentlich du, hat diese Adresse für die Produkt-Updates von Eduskript angemeldet. Ein paar Mal im Jahr schreibe ich, was neu ist. Bitte bestätige die Anmeldung:</p>
${button('Anmeldung bestätigen')}
<p>Ohne Bestätigung erhältst du nichts, und die Adresse wird nach 7 Tagen gelöscht. Abmelden geht jederzeit über den Link in jeder Mail.</p>
<p>Herzliche Grüsse<br>Marc Chéhab</p>`),
      text: `Hallo

Jemand, hoffentlich du, hat diese Adresse für die Produkt-Updates von Eduskript angemeldet. Ein paar Mal im Jahr schreibe ich, was neu ist. Bitte bestätige die Anmeldung:

${confirmUrl}

Ohne Bestätigung erhältst du nichts, und die Adresse wird nach 7 Tagen gelöscht. Abmelden geht jederzeit über den Link in jeder Mail.

Herzliche Grüsse
Marc Chéhab
`,
    }
  }
  return {
    subject: 'Confirm: Eduskript product updates',
    html: wrap(`<p>Hi</p>
<p>Someone, hopefully you, signed this address up for Eduskript product updates. A few times a year I write about what's new. Please confirm:</p>
${button('Confirm sign-up')}
<p>Without confirmation you get nothing, and the address is deleted after 7 days. You can unsubscribe any time via the link in each mail.</p>
<p>Best regards<br>Marc Chéhab</p>`),
    text: `Hi

Someone, hopefully you, signed this address up for Eduskript product updates. A few times a year I write about what's new. Please confirm:

${confirmUrl}

Without confirmation you get nothing, and the address is deleted after 7 days. You can unsubscribe any time via the link in each mail.

Best regards
Marc Chéhab
`,
  }
}

/**
 * Guest signup from the <newsletter /> block. Stores (or refreshes) an
 * unconfirmed row and mails the confirmation link. Does nothing when the
 * address already gets product updates (confirmed guest or opted-in teacher).
 * The return value is for tests/logging only — the route answers the same
 * either way, so the form can't be used to probe addresses. Throws if the
 * confirmation mail can't be sent.
 */
export async function requestGuestSubscription(
  email: string,
  lang: MailLanguage
): Promise<'confirmation-sent' | 'already-subscribed'> {
  const addr = email.trim().toLowerCase()
  await purgeUnconfirmedGuests()
  const [existing, teacher] = await Promise.all([
    prisma.productUpdateSubscriber.findUnique({ where: { email: addr }, select: { confirmedAt: true } }),
    prisma.user.findFirst({
      where: mailableTeacherWhere({ productUpdates: true, email: { equals: addr, mode: 'insensitive' } }),
      select: { id: true },
    }),
  ])
  if (existing?.confirmedAt || teacher) return 'already-subscribed'

  // A repeated unconfirmed signup keeps the row (and its 7-day clock) and
  // re-sends the same link; the per-address rate limit bounds the re-sends.
  const row = await prisma.productUpdateSubscriber.upsert({
    where: { email: addr },
    create: { email: addr, lang },
    update: { lang },
    select: { id: true },
  })
  const confirmUrl = `${baseUrl()}/subscribe?token=${encodeURIComponent(signUserToken('guest-confirm', row.id))}`
  const mail = guestConfirmMail(lang, confirmUrl)
  await sendEmail({
    to: addr,
    subject: mail.subject,
    htmlContent: mail.html,
    textContent: mail.text,
    from: PRODUCT_UPDATE_FROM,
    replyTo: PRODUCT_UPDATE_REPLY_TO,
    tag: 'product-update-guest-confirm',
  })
  return 'confirmation-sent'
}

/**
 * The confirm button (POST, never the page view). If the address belongs to
 * a mailable teacher account, the teacher's own flag is set and the guest row
 * deleted — one subscription per address, managed in the account settings.
 * Otherwise the row is marked confirmed. Returns false for unknown or
 * expired (unconfirmed > 7 days, row deleted here) subscriptions.
 */
export async function confirmGuest(subscriberId: string): Promise<boolean> {
  const row = await prisma.productUpdateSubscriber.findUnique({ where: { id: subscriberId } })
  if (!row) return false
  if (!row.confirmedAt && row.createdAt.getTime() < Date.now() - GUEST_CONFIRM_TTL_MS) {
    await prisma.productUpdateSubscriber.deleteMany({ where: { id: subscriberId } })
    return false
  }
  const teacher = await prisma.user.findFirst({
    where: mailableTeacherWhere({ email: { equals: row.email, mode: 'insensitive' } }),
    select: { id: true },
  })
  if (teacher) {
    await setProductUpdates(teacher.id, true)
    await prisma.productUpdateSubscriber.deleteMany({ where: { id: subscriberId } })
    return true
  }
  if (!row.confirmedAt) {
    await prisma.productUpdateSubscriber.update({ where: { id: subscriberId }, data: { confirmedAt: new Date() } })
  }
  return true
}

/** Guest unsubscribe: the row is deleted. Unknown ids are a no-op. */
export async function unsubscribeGuest(subscriberId: string): Promise<void> {
  await prisma.productUpdateSubscriber.deleteMany({ where: { id: subscriberId } })
}

// --------------------------------------------------------------------- drafts

export function approveUrl(draft: { id: string; expiresAt: Date }): string {
  const token = signApproveToken(draft.id, draft.expiresAt)
  return `${baseUrl()}/dashboard/admin/product-updates/${draft.id}?token=${encodeURIComponent(token)}`
}

export async function createDraft(input: {
  fromAddr: string
  subject: string
  bodyHtml: string | null
  bodyText: string | null
}) {
  const draft = await prisma.productUpdate.create({
    data: { ...input, expiresAt: new Date(Date.now() + APPROVAL_TTL_MS) },
  })
  await sendPreviewToAdmins(draft)
  return draft
}

/**
 * Mail the admins the update as a German-language recipient would see it,
 * with an approval box on top. The unsubscribe link in the preview is a
 * placeholder that does nothing. Never throws (the draft is already stored
 * and can still be found in the admin list).
 */
async function sendPreviewToAdmins(draft: {
  id: string
  subject: string
  bodyHtml: string | null
  bodyText: string | null
  fromAddr: string
  expiresAt: Date
}): Promise<void> {
  try {
    const admins = await getAdminNotificationRecipients()
    if (admins.length === 0) {
      log.error(`product update ${draft.id}: no admin recipients for the preview`)
      return
    }
    const count = (await getRecipients()).length
    const url = approveUrl(draft)
    const rendered = renderProductUpdate(draft, 'de', unsubscribePageUrl('preview'))

    const box = `<div style="font-family:Arial,sans-serif;border:2px solid #2563eb;border-radius:8px;padding:12px 16px;margin:0 0 24px;background:#eff6ff;color:#1e3a8a;">
<b>Product update waiting for approval</b><br>
From ${escapeHtml(draft.fromAddr)} · would go to ${count} recipient${count === 1 ? '' : 's'} (opted-in teachers and confirmed subscribers without an account).<br>
<a href="${escapeHtml(url)}" style="color:#2563eb;font-weight:bold;">Review and send</a> (admin login required, link valid 24 h, works once). Discard on the same page.<br>
<span style="font-size:12px;">Below: the mail as a German-language recipient gets it.</span>
</div>`

    await sendEmail({
      to: admins,
      subject: `[Approval needed] ${draft.subject}`,
      htmlContent: injectAfterBodyStart(rendered.html, box),
      textContent: `Product update waiting for approval (${count} recipients).\nReview and send: ${url}\n\n---\n\n${rendered.text}`,
      tag: 'product-update-preview',
    })
  } catch (error) {
    log.error(`product update ${draft.id}: preview mail failed: ${(error as Error)?.message ?? String(error)}`)
  }
}

export type ClaimResult =
  | { ok: true; recipients: Recipient[] }
  | { ok: false; reason: 'not-found' | 'invalid-token' | 'expired' | 'not-pending' }

/**
 * Check the approve link and atomically move the draft pending → sending.
 * Only one caller can win the conditional update, so double clicks and
 * replays of the link are no-ops. Callers must already have checked that the
 * session user is an admin (the route does; this function trusts adminId).
 */
export async function approveAndClaim(draftId: string, token: string, adminId: string): Promise<ClaimResult> {
  const draft = await prisma.productUpdate.findUnique({ where: { id: draftId } })
  if (!draft) return { ok: false, reason: 'not-found' }
  if (!verifyApproveToken(draft.id, draft.expiresAt, token)) return { ok: false, reason: 'invalid-token' }
  if (draft.status !== 'pending') return { ok: false, reason: 'not-pending' }
  const now = new Date()
  if (draft.expiresAt <= now) return { ok: false, reason: 'expired' }

  await purgeUnconfirmedGuests(now)
  const recipients = await getRecipients()
  const claimed = await prisma.productUpdate.updateMany({
    where: { id: draftId, status: 'pending', expiresAt: { gt: now } },
    data: { status: 'sending', approvedById: adminId, approvedAt: now, recipientCount: recipients.length },
  })
  if (claimed.count !== 1) return { ok: false, reason: 'not-pending' }
  return { ok: true, recipients }
}

/** Discard a pending draft. Same token check as approve; expiry not required. */
export async function discardDraft(draftId: string, token: string): Promise<boolean> {
  const draft = await prisma.productUpdate.findUnique({ where: { id: draftId } })
  if (!draft || !verifyApproveToken(draft.id, draft.expiresAt, token)) return false
  const res = await prisma.productUpdate.updateMany({
    where: { id: draftId, status: 'pending' },
    data: { status: 'discarded', finishedAt: new Date() },
  })
  return res.count === 1
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send a claimed draft to each recipient, one SMTP message per person.
 * Counts are written per recipient so the admin page shows progress.
 * O(n) sequential sends, n × (SMTP round trip + delayMs).
 */
export async function sendClaimedDraft(
  draftId: string,
  recipients: Recipient[],
  delayMs = SEND_DELAY_MS
): Promise<{ sent: number; failed: number }> {
  const draft = await prisma.productUpdate.findUnique({ where: { id: draftId } })
  if (!draft || draft.status !== 'sending') return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  for (const [i, r] of recipients.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs)
    const token = signUserToken(r.kind === 'guest' ? 'guest-unsubscribe' : 'unsubscribe', r.id)
    const { html, text } = renderProductUpdate(draft, r.lang, unsubscribePageUrl(token))
    try {
      await sendEmail({
        to: r.email,
        subject: draft.subject,
        htmlContent: html,
        textContent: text,
        from: PRODUCT_UPDATE_FROM,
        replyTo: PRODUCT_UPDATE_REPLY_TO,
        headers: listUnsubscribeHeaders(token),
        tag: 'product-update',
      })
      sent++
      await prisma.productUpdate.update({ where: { id: draftId }, data: { sentCount: { increment: 1 } } })
    } catch {
      // sendEmail already logged the SMTP error; don't log the address.
      failed++
      await prisma.productUpdate.update({ where: { id: draftId }, data: { failedCount: { increment: 1 } } })
    }
  }

  await prisma.productUpdate.update({
    where: { id: draftId },
    data: { status: 'sent', finishedAt: new Date() },
  })
  console.info(`[product-updates] ${draftId} done: ${sent} sent, ${failed} failed`)
  return { sent, failed }
}

// -------------------------------------------------------- one-time consent mail

/** Mailable teachers who have not opted in — the consent mail's audience. */
export function getConsentCandidates(): Promise<Recipient[]> {
  return findTeachers({ productUpdates: false })
}

function consentMail(lang: MailLanguage, subscribeUrl: string, name: string | null) {
  const url = escapeHtml(subscribeUrl)
  const button = (label: string) =>
    `<p style="margin:24px 0;"><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">${label}</a></p>`
  const wrap = (body: string) => `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;">${body}</div>`
  const first = name?.trim().split(/\s+/)[0]
  if (lang === 'de') {
    const hi = first ? `Hallo ${escapeHtml(first)}` : 'Hallo'
    return {
      subject: 'Produkt-Updates von Eduskript?',
      html: wrap(`<p>${hi}</p>
<p>Möchtest du Produkt-Updates von Eduskript erhalten? Ein paar Mal im Jahr schreibe ich, was neu ist. Ohne Klick bekommst du keine.</p>
${button('Ja, anmelden')}
<p>Abmelden geht jederzeit über den Link in jeder Mail oder in den Kontoeinstellungen.</p>
<p>Herzliche Grüsse<br>Marc Chéhab</p>`),
      text: `${hi}\n\nMöchtest du Produkt-Updates von Eduskript erhalten? Ein paar Mal im Jahr schreibe ich, was neu ist. Ohne Klick bekommst du keine.\n\nJa, anmelden: ${subscribeUrl}\n\nAbmelden geht jederzeit über den Link in jeder Mail oder in den Kontoeinstellungen.\n\nHerzliche Grüsse\nMarc Chéhab\n`,
    }
  }
  const hi = first ? `Hi ${escapeHtml(first)}` : 'Hi'
  return {
    subject: 'Product updates from Eduskript?',
    html: wrap(`<p>${hi}</p>
<p>Would you like to get product updates from Eduskript? A few times a year I write about what's new. Without a click you won't get any.</p>
${button('Yes, sign me up')}
<p>You can unsubscribe any time via the link in each mail or in your account settings.</p>
<p>Best regards<br>Marc Chéhab</p>`),
    text: `${hi}\n\nWould you like to get product updates from Eduskript? A few times a year I write about what's new. Without a click you won't get any.\n\nYes, sign me up: ${subscribeUrl}\n\nYou can unsubscribe any time via the link in each mail or in your account settings.\n\nBest regards\nMarc Chéhab\n`,
  }
}

/**
 * Send the one-time "do you want product updates?" mail to every mailable
 * teacher who hasn't opted in. Not idempotent: running it twice mails the
 * same people twice — the admin UI asks for confirmation with the count.
 */
export async function sendConsentRequests(
  recipients: Recipient[],
  delayMs = SEND_DELAY_MS
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const [i, r] of recipients.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs)
    const subscribeUrl = `${baseUrl()}/subscribe?token=${encodeURIComponent(signUserToken('subscribe', r.id))}`
    const mail = consentMail(r.lang, subscribeUrl, r.name)
    try {
      await sendEmail({
        to: r.email,
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        from: PRODUCT_UPDATE_FROM,
        replyTo: PRODUCT_UPDATE_REPLY_TO,
        tag: 'product-update-consent',
      })
      sent++
    } catch {
      failed++
    }
  }
  console.info(`[product-updates] consent request done: ${sent} sent, ${failed} failed`)
  return { sent, failed }
}
