/**
 * Trial lifecycle mails (German, via Brevo transactional — src/lib/email.ts).
 *
 * - `welcome`: right when the account becomes usable — after email
 *   verification (verify-email route) or at OAuth signup (privacy-adapter).
 *   Points to the onboarding quest in the dashboard; no videos in the mail
 *   on purpose, the quest is the one place that walks through the steps.
 * - `ending`: 5 days before the trial ends — what Classroom adds, the price,
 *   and that nothing is charged automatically.
 * - `ended`:  after the cron expired the trial — pages stay online, how to
 *   continue with Classroom.
 *
 * A day-3 mail is deliberately not here yet (content still open).
 *
 * ending/ended are sent by the daily cron (src/app/api/cron/route.ts, 03:00 UTC), right after
 * it expires due trials. Each mail has a send window rather than an exact day
 * (ending: trial end 3–5 days away; ended: trial end 0–3 days ago), so a
 * missed cron run is caught up the next day, and trials that ended long
 * before this shipped never get a late mail. "Already sent" is recorded per
 * subscription in UserData (adapter 'trial-emails', itemId = subscription id),
 * so a second trial on the same account would get its own pair.
 *
 * Recipients: teachers with a real address that is verified or came from an
 * OAuth sign-in (no password set). German only for now — the audience is
 * almost entirely German-speaking; English copy would go here if needed.
 */

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { DEFAULT_TRIAL_DAYS, PLAN_COPY, formatChf, monthlyEquivalent } from '@/lib/plan-copy'

export type TrialEmailKind = 'welcome' | 'ending' | 'ended'

const DAY_MS = 24 * 60 * 60 * 1000
const ADAPTER = 'trial-emails'
const SENDER_NAME = 'Marc von Eduskript'
const REPLY_TO = 'marc@informatikgarten.ch'

export interface TrialEmailPrices {
  yearly?: number // Rappen
  monthly?: number // Rappen
}

export interface TrialEmailContext {
  firstName: string | null
  trialEnd: Date
  daysLeft: number
  // Plan trial length; the quest reward adds the same amount again (trial.ts).
  trialDays: number
  prices: TrialEmailPrices
  baseUrl: string
}

/** "Marc Chéhab" → "Marc"; titles ("Dr.") or empty names → null (plain "Hallo"). */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  if (!first || first.endsWith('.')) return null
  return first
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDateDe(date: Date): string {
  return date.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' })
}

function priceLine(prices: TrialEmailPrices): string | null {
  const parts: string[] = []
  if (prices.yearly) {
    parts.push(`${formatChf(prices.yearly)} im Jahr (rund ${formatChf(monthlyEquivalent(prices.yearly))} pro Monat)`)
  }
  if (prices.monthly) parts.push(`${formatChf(prices.monthly)} monatlich`)
  return parts.length ? parts.join(' oder ') : null
}

interface Rendered {
  subject: string
  htmlContent: string
  textContent: string
}

// Plain, personal layout — reads like a mail from a person, not a newsletter.
// Blocks are HTML strings; plain text ones get wrapped in <p>.
function layout(blocks: string[]): string {
  const body = blocks
    .map((block) => (block.startsWith('<ul') || block.startsWith('<p') ? block : `<p style="margin:0 0 16px">${block}</p>`))
    .join('\n')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
${body}
</body></html>`
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="background:#2563eb;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">${label}</a></p>`
}

// Swiss letter style: no comma, next paragraph starts capitalised.
function greeting(firstName: string | null): string {
  return firstName ? `Hallo ${firstName}` : 'Hallo'
}

export function renderTrialEmail(kind: TrialEmailKind, ctx: TrialEmailContext): Rendered {
  const billingUrl = `${ctx.baseUrl}/dashboard/billing`
  const features = PLAN_COPY.de.classroom.features
  const prices = priceLine(ctx.prices)
  const name = ctx.firstName ? escapeHtml(ctx.firstName) : null
  const footer =
    'Du bekommst diese Mail, weil du den Test von Eduskript gestartet hast. Nach dem Testende schicke ich dir noch eine kurze Mail, dann keine weiteren Erinnerungen.'
  const footerEnded =
    'Das war die letzte Mail zu deinem Test. Weitere Erinnerungen kommen keine.'

  if (kind === 'welcome') {
    const dashboardUrl = `${ctx.baseUrl}/dashboard`
    const intro =
      'Schön, dass du Eduskript ausprobierst! Ich bin Marc und unterrichte Informatik in Zürich. Ich habe Eduskript gebaut, weil ich meine Skripts lieber als interaktive Website abgebe, die ich aktualisieren kann – du hoffentlich auch 😊'
    const tour = (dashboard: string) =>
      `Wie geht's weiter? Im ${dashboard} führt dich eine kurze Erklär-Tour durch die ersten Schritte. Wenn du sie meisterst, verdoppelt sich deine Testzeit auf ${ctx.trialDays * 2} Tage – es lohnt sich also!`
    const plan = `Du hast jetzt ${ctx.trialDays} Tage lang alle Funktionen – inklusive KI und Klassenverwaltung, die mir ein Loch ins Portemonnaie brennen. Danach läuft dein Konto im Gratis-Plan weiter, deine Skripts bleiben online.`
    const ps = 'PS: Warum ging das interaktive Skript zum Arzt? Es hatte zu viele Seiten-Effekte 🤷'
    const html = layout([
      greeting(name),
      intro,
      tour(`<a href="${dashboardUrl}" style="color:#2563eb">Dashboard</a>`),
      plan,
      'Fragen? Antworte einfach auf diese Mail.<br>Marc',
      ps,
    ])
    const text = [
      greeting(ctx.firstName),
      '',
      intro,
      '',
      tour(`Dashboard (${dashboardUrl})`),
      '',
      plan,
      '',
      'Fragen? Antworte einfach auf diese Mail.',
      'Marc',
      '',
      ps,
    ].join('\n')
    return { subject: 'Willkommen bei Eduskript', htmlContent: html, textContent: text }
  }

  if (kind === 'ending') {
    const days = ctx.daysLeft === 1 ? '1 Tag' : `${ctx.daysLeft} Tage`
    const date = formatDateDe(ctx.trialEnd)
    const subject = `Dein Eduskript-Test läuft noch ${days}`
    const html = layout(
      [
        greeting(name),
        `Dein Test von Eduskript läuft noch ${days}, bis am ${date}. Danach wechselt dein Konto automatisch in den Gratis-Plan. Es wird nichts belastet.`,
        `Deine Skripts und deine öffentliche Seite bleiben online. Ohne Classroom fällt weg:`,
        `<ul style="margin:0 0 16px;padding-left:20px">${features.map((f) => `<li>${f}</li>`).join('')}</ul>`,
        prices ? `Classroom kostet ${prices}.` : 'Mit Classroom behältst du alles.',
        button(billingUrl, 'Classroom ansehen'),
        `Fragen? Antworte einfach auf diese Mail.<br>Marc`,
        `<span style="color:#6b7280;font-size:13px">${footer}</span>`,
      ]
    )
    const text = [
      greeting(ctx.firstName),
      '',
      `Dein Test von Eduskript läuft noch ${days}, bis am ${date}. Danach wechselt dein Konto automatisch in den Gratis-Plan. Es wird nichts belastet.`,
      '',
      'Deine Skripts und deine öffentliche Seite bleiben online. Ohne Classroom fällt weg:',
      ...features.map((f) => `- ${f}`),
      '',
      prices ? `Classroom kostet ${prices}.` : 'Mit Classroom behältst du alles.',
      `Classroom ansehen: ${billingUrl}`,
      '',
      'Fragen? Antworte einfach auf diese Mail.',
      'Marc',
      '',
      footer,
    ].join('\n')
    return { subject, htmlContent: html, textContent: text }
  }

  const subject = 'Dein Eduskript-Test ist beendet, deine Seiten bleiben online'
  const html = layout(
    [
      greeting(name),
      `Dein Test von Eduskript ist abgelaufen. Dein Konto läuft jetzt im Gratis-Plan weiter: Deine Skripts und deine öffentliche Seite bleiben online, und du kannst weiterhin unbegrenzt schreiben und veröffentlichen.`,
      (prices
        ? `Für KI-Bearbeitung, Klassen, Prüfungen im Safe Exam Browser und die KI-Korrektur brauchst du Classroom, für ${prices}.`
        : 'Für KI-Bearbeitung, Klassen, Prüfungen im Safe Exam Browser und die KI-Korrektur brauchst du Classroom.'),
      button(billingUrl, 'Weiter mit Classroom'),
      `Fragen? Antworte einfach auf diese Mail.<br>Marc`,
      `<span style="color:#6b7280;font-size:13px">${footerEnded}</span>`,
    ]
  )
  const text = [
    greeting(ctx.firstName),
    '',
    'Dein Test von Eduskript ist abgelaufen. Dein Konto läuft jetzt im Gratis-Plan weiter: Deine Skripts und deine öffentliche Seite bleiben online, und du kannst weiterhin unbegrenzt schreiben und veröffentlichen.',
    '',
    prices
      ? `Für KI-Bearbeitung, Klassen, Prüfungen im Safe Exam Browser und die KI-Korrektur brauchst du Classroom, für ${prices}.`
      : 'Für KI-Bearbeitung, Klassen, Prüfungen im Safe Exam Browser und die KI-Korrektur brauchst du Classroom.',
    `Weiter mit Classroom: ${billingUrl}`,
    '',
    'Fragen? Antworte einfach auf diese Mail.',
    'Marc',
    '',
    footerEnded,
  ].join('\n')
  return { subject, htmlContent: html, textContent: text }
}

const recipientSelect = {
  id: true,
  name: true,
  email: true,
  accountType: true,
  emailVerified: true,
  hashedPassword: true,
} as const

type Recipient = {
  id: string
  name: string | null
  email: string | null
  accountType: string
  emailVerified: Date | null
  hashedPassword: string | null
}

function isMailable(user: Recipient): user is Recipient & { email: string } {
  if (user.accountType !== 'teacher' || !user.email) return false
  // Students/temp accounts carry synthetic @eduskript.local addresses.
  if (user.email.endsWith('@eduskript.local')) return false
  // Password signups must have confirmed the address; OAuth sign-ins have
  // no password and a provider-confirmed address.
  return user.emailVerified !== null || user.hashedPassword === null
}

async function alreadySent(userId: string, subscriptionId: string, kind: TrialEmailKind): Promise<boolean> {
  const row = await prisma.userData.findFirst({
    where: { userId, adapter: ADAPTER, itemId: subscriptionId, targetType: null, targetId: null },
    select: { data: true },
  })
  return Boolean((row?.data as Record<string, unknown> | undefined)?.[kind])
}

async function markSent(userId: string, subscriptionId: string, kind: TrialEmailKind): Promise<void> {
  const where = { userId, adapter: ADAPTER, itemId: subscriptionId, targetType: null, targetId: null }
  const row = await prisma.userData.findFirst({ where, select: { id: true, data: true } })
  const data = { ...((row?.data as Record<string, unknown> | undefined) ?? {}), [kind]: Date.now() }
  if (row) {
    await prisma.userData.update({ where: { id: row.id }, data: { data } })
  } else {
    await prisma.userData.create({ data: { userId, adapter: ADAPTER, itemId: subscriptionId, data } })
  }
}

async function loadPrices(): Promise<TrialEmailPrices> {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, slug: { in: ['classroom-yearly', 'classroom-monthly'] } },
    select: { slug: true, priceChf: true },
  })
  return {
    yearly: plans.find((p) => p.slug === 'classroom-yearly')?.priceChf,
    monthly: plans.find((p) => p.slug === 'classroom-monthly')?.priceChf,
  }
}

const subscriptionSelect = {
  id: true,
  currentPeriodEnd: true,
  plan: { select: { trialDays: true } },
  user: { select: recipientSelect },
} as const

type MailSubscription = {
  id: string
  currentPeriodEnd: Date | null
  plan: { trialDays: number | null }
  user: Recipient
}

/** Render + send one mail and record it. Returns false if skipped or failed. */
async function deliver(
  kind: TrialEmailKind,
  sub: MailSubscription,
  prices: TrialEmailPrices,
  now: Date
): Promise<boolean> {
  const user = sub.user
  if (!sub.currentPeriodEnd || !isMailable(user)) return false
  if (await alreadySent(user.id, sub.id, kind)) return false
  const rendered = renderTrialEmail(kind, {
    firstName: firstNameOf(user.name),
    trialEnd: sub.currentPeriodEnd,
    daysLeft: Math.max(1, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS)),
    trialDays: sub.plan.trialDays ?? DEFAULT_TRIAL_DAYS,
    prices,
    baseUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
  })
  await sendEmail({
    to: user.email,
    ...rendered,
    tag: `trial-${kind}`,
    senderName: SENDER_NAME,
    replyTo: REPLY_TO,
  })
  await markSent(user.id, sub.id, kind)
  return true
}

/**
 * Welcome mail, once the account is usable. Call sites: verify-email route
 * (password signups) and privacy-adapter createUser (OAuth). No-op without a
 * trialing subscription or for an unverified password account. Never throws —
 * signup must not depend on Brevo.
 */
export async function sendWelcomeEmail(userId: string): Promise<void> {
  try {
    const sub = await prisma.subscription.findFirst({
      where: { userId, status: 'trialing' },
      select: subscriptionSelect,
    })
    if (sub) await deliver('welcome', sub, {}, new Date())
  } catch (error) {
    console.error(`[trial-emails] welcome to user ${userId} failed:`, error)
  }
}

/**
 * Send all due ending/ended mails. Returns counts for the cron result. One
 * failing send is logged and skipped (not marked sent, so it retries next run
 * while still inside its window).
 */
export async function sendDueTrialEmails(now = new Date()): Promise<{ ending: number; ended: number; failed: number }> {
  const counts = { ending: 0, ended: 0, failed: 0 }

  const ending = await prisma.subscription.findMany({
    where: {
      status: 'trialing',
      currentPeriodEnd: { gte: new Date(now.getTime() + 3 * DAY_MS), lte: new Date(now.getTime() + 5 * DAY_MS) },
    },
    select: subscriptionSelect,
  })

  // Expired trials: the cron sets status 'cancelled'. payrexxSubId null tells
  // a trial apart from a cancelled paid subscription. Skip users who have
  // since subscribed (or got a new trial).
  const ended = await prisma.subscription.findMany({
    where: {
      status: 'cancelled',
      payrexxSubId: null,
      currentPeriodEnd: { gte: new Date(now.getTime() - 3 * DAY_MS), lte: now },
      user: { subscriptions: { none: { status: { in: ['active', 'trialing', 'past_due'] } } } },
    },
    select: subscriptionSelect,
  })

  if (ending.length === 0 && ended.length === 0) return counts
  const prices = await loadPrices()

  const batches: ['ending' | 'ended', MailSubscription[]][] = [
    ['ending', ending],
    ['ended', ended],
  ]
  for (const [kind, subs] of batches) {
    for (const sub of subs) {
      try {
        if (await deliver(kind, sub, prices, now)) counts[kind]++
      } catch (error) {
        console.error(`[trial-emails] ${kind} to user ${sub.user.id} failed:`, error)
        counts.failed++
      }
    }
  }
  return counts
}
