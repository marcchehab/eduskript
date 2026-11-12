/**
 * Email-code login: sign-up / sign-in with a 6-digit code sent by mail, plus
 * one-click class-invite links. Works for teachers and students without an
 * OAuth app (school Microsoft tenants often block third-party consent).
 *
 * Privacy (see /datenschutz, EMAIL-LOGIN.md): the plaintext address only lives
 * in the request that receives it (HMAC + SMTP send) and is never written to
 * the DB or the log. Tokens are keyed by generatePseudonym(email). Teachers'
 * addresses are stored as usual on their User row; students' never are.
 *
 * Wiring:
 * - POST /api/auth/email-code/request   → requestLoginCode()
 * - CredentialsProvider 'email-code'     → loginWithCode() / loginWithInvite()
 *   (src/lib/auth.ts)
 * - bulk-import route, sendInvites=true  → sendClassInvites()
 * - /auth/invite/[token] page            → findInvite(), optOutViaInvite()
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { prisma, prismaBase } from '@/lib/prisma'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { PrivacyAdapter, createStudentUser, type SignupContext } from '@/lib/privacy-adapter'
import { sendEmail } from '@/lib/email'
import { createLogger } from '@/lib/logger'
import { parseSignupContext } from '@/lib/signup-context'

const log = createLogger('auth:email-code')

export const CODE_TTL_MS = 10 * 60 * 1000
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const MAX_CODE_ATTEMPTS = 5

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.toLowerCase().trim()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
// Codes are only 6 digits, so two people can hold the same code at once; the
// pseudonym in the hash keeps tokenHash (unique column) collision-free.
const codeHash = (pseudonym: string, code: string) => sha256(`code:${pseudonym}:${code}`)
const inviteHash = (token: string) => sha256(`invite:${token}`)

function baseUrl(): string {
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Teacher-chosen strings in invite mails: escaped, capped, no URLs autolinked. */
function mailSafe(value: string | null | undefined, max = 80): string {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  const capped = trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
  // Break "." so mail clients don't autolink a class name like "evil.example".
  return escapeHtml(capped).replace(/\./g, '.&#8203;')
}

function mailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: white; padding: 30px; border-radius: 10px; border: 1px solid #e5e7eb;">
${bodyHtml}
</div>
<div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px;"><p>Eduskript</p></div>
</body></html>`
}

// ─── Login codes ────────────────────────────────────────────────────────────

/**
 * Create a code for this address and mail it. Replaces any earlier code for
 * the same address. Sends to any syntactically valid address (self-signup is
 * allowed); callers rate-limit and always answer the client the same way.
 */
export async function requestLoginCode(email: string): Promise<void> {
  const pseudonym = generatePseudonym(email)
  const now = new Date()

  // Housekeeping instead of a cron job: expired rows of any address.
  await prisma.emailLoginToken.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.emailLoginToken.deleteMany({ where: { pseudonym, kind: 'code' } })

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  await prisma.emailLoginToken.create({
    data: {
      pseudonym,
      kind: 'code',
      tokenHash: codeHash(pseudonym, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  })

  const html = mailLayout('Your Eduskript login code', `
<h2 style="color: #374151; margin-top: 0;">Your login code</h2>
<p>Enter this code on the Eduskript sign-in page:</p>
<p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; margin: 30px 0;">${code}</p>
<p style="color: #6b7280; font-size: 14px;">The code is valid for 10 minutes. If you didn't request it, you can ignore this email.</p>`)
  const text = `Your Eduskript login code: ${code}\n\nThe code is valid for 10 minutes. If you didn't request it, you can ignore this email.`

  await sendEmail({
    to: email,
    subject: `${code} is your Eduskript login code`,
    htmlContent: html,
    textContent: text,
    tag: 'login-code',
  })
}

export type CodeCheck = 'ok' | 'invalid' | 'expired' | 'locked'

/**
 * Check a code without consuming it on success (the caller consumes it once
 * the account is resolved). A wrong guess counts towards MAX_CODE_ATTEMPTS.
 */
export async function checkLoginCode(email: string, code: string): Promise<{ result: CodeCheck; tokenId?: string }> {
  const pseudonym = generatePseudonym(email)
  const row = await prisma.emailLoginToken.findFirst({
    where: { pseudonym, kind: 'code' },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) return { result: 'invalid' }
  if (row.expiresAt < new Date()) return { result: 'expired' }
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { result: 'locked' }

  const expected = Buffer.from(row.tokenHash, 'hex')
  const actual = Buffer.from(codeHash(pseudonym, code.trim()), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.emailLoginToken.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    return { result: 'invalid' }
  }
  return { result: 'ok', tokenId: row.id }
}

// ─── Account resolution ─────────────────────────────────────────────────────

/** Only the explicit context formats; anything else falls back to student. */
export function sanitizeSignupContext(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return /^(student|student-org|teacher-org):[a-z0-9-]{1,64}$/.test(raw) || raw === 'teacher-signup' ? raw : ''
}

export interface LoginUser {
  id: string
  email: string | null
  name: string | null
  image: string | null
}

/**
 * Find the account for a verified address, or create it.
 * Order: teacher by stored email → student by pseudonym → new account whose
 * type comes from the sign-in page's context (teacher page / student column
 * → student; teacher column / signup page → teacher).
 */
export async function resolveUserForEmail(email: string, signupContext: SignupContext): Promise<LoginUser> {
  const teacher = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, name: true, image: true, emailVerified: true },
  })
  if (teacher) {
    // The code proves the address; also unlocks password accounts that never
    // clicked the verification link.
    if (!teacher.emailVerified) {
      await prisma.user.update({ where: { id: teacher.id }, data: { emailVerified: new Date() } })
    }
    return { id: teacher.id, email: teacher.email, name: teacher.name, image: teacher.image }
  }

  const pseudonym = generatePseudonym(email)
  const student = await prisma.user.findFirst({
    where: { studentPseudonym: pseudonym },
    select: { id: true, name: true },
  })
  // Email returned for students goes into the JWT only (token.oauthEmail,
  // shown to the student), never into the DB, same as OAuth students.
  if (student) return { id: student.id, email, name: student.name, image: null }

  if (signupContext.isStudent) {
    const created = await createStudentUser(prismaBase, pseudonym, signupContext)
    return { id: created.id, email, name: created.name, image: null }
  }

  // New teacher: same path as an OAuth teacher signup (Site, trial, seed
  // skript, org joins, welcome + admin mail), with the address verified.
  const adapter = PrivacyAdapter({ prisma: prismaBase, isStudentSignup: () => signupContext })
  const created = await adapter.createUser!({ id: "", email, emailVerified: new Date(), name: null, image: null })
  return { id: created.id, email: created.email, name: created.name ?? null, image: null }
}

/** Verify the code, resolve/create the account, consume the code. */
export async function loginWithCode(email: string, code: string, rawContext: unknown): Promise<LoginUser> {
  const { result, tokenId } = await checkLoginCode(email, code)
  if (result !== 'ok') throw new Error(`EMAIL_CODE_${result.toUpperCase()}`)

  const user = await resolveUserForEmail(email, await parseSignupContext(sanitizeSignupContext(rawContext)))
  await prisma.emailLoginToken.deleteMany({ where: { id: tokenId } })
  log.info(`Email-code login: user ${user.id}`)
  return user
}

// ─── Class invites ──────────────────────────────────────────────────────────

export async function findInvite(token: string) {
  if (typeof token !== 'string' || token.length > 128) return null
  const row = await prisma.emailLoginToken.findUnique({ where: { tokenHash: inviteHash(token) } })
  if (!row || row.kind !== 'invite' || row.expiresAt < new Date() || !row.classId) return null
  const cls = await prisma.class.findUnique({
    where: { id: row.classId },
    select: { id: true, name: true, inviteCode: true, isActive: true, archivedAt: true, teacher: { select: { name: true } } },
  })
  if (!cls || !cls.isActive || cls.archivedAt) return null
  return { row, cls }
}

/**
 * Consume an invite link and log the student in. The server never had the
 * address here, only the pseudonym, so the account is found/created by it.
 */
export async function loginWithInvite(token: string): Promise<LoginUser & { inviteCode: string }> {
  const invite = await findInvite(token)
  if (!invite) throw new Error('INVITE_INVALID')
  const { row, cls } = invite

  const existing = await prisma.user.findFirst({
    where: { studentPseudonym: row.pseudonym },
    select: { id: true, name: true },
  })
  const user = existing ?? (await createStudentUser(prismaBase, row.pseudonym, { isStudent: true }))
  await prisma.emailLoginToken.deleteMany({ where: { id: row.id } })
  log.info(`Invite login: user ${user.id}, class ${cls.id}`)
  return { id: user.id, email: null, name: user.name, image: null, inviteCode: cls.inviteCode }
}

export async function optOutViaInvite(token: string): Promise<boolean> {
  const invite = await findInvite(token)
  if (!invite) return false
  await prisma.inviteOptOut.upsert({
    where: { pseudonym: invite.row.pseudonym },
    create: { pseudonym: invite.row.pseudonym },
    update: {},
  })
  await prisma.emailLoginToken.deleteMany({ where: { pseudonym: invite.row.pseudonym, kind: 'invite' } })
  return true
}

/**
 * Mail an invite link to each address (already pre-authorized by the caller).
 * Skips opted-out recipients. Sends 5 at a time; returns the addresses that
 * went out so the teacher's browser can show "invited <date>".
 * `allow` is called once per recipient (per-teacher rate limit).
 */
export async function sendClassInvites(opts: {
  classId: string
  className: string
  teacherName: string | null
  recipients: { email: string; pseudonym: string }[]
  allow: () => boolean
}): Promise<{ sent: string[]; failed: number; optedOut: number; limited: number }> {
  const optOuts = new Set(
    (await prisma.inviteOptOut.findMany({
      where: { pseudonym: { in: opts.recipients.map((r) => r.pseudonym) } },
      select: { pseudonym: true },
    })).map((o) => o.pseudonym)
  )

  const queue: typeof opts.recipients = []
  let limited = 0
  for (const r of opts.recipients) {
    if (optOuts.has(r.pseudonym)) continue
    if (!opts.allow()) { limited++; continue }
    queue.push(r)
  }

  const teacher = mailSafe(opts.teacherName || 'Your teacher')
  const className = mailSafe(opts.className)
  const sent: string[] = []
  let failed = 0

  const sendOne = async ({ email, pseudonym }: { email: string; pseudonym: string }) => {
    const token = randomBytes(32).toString('base64url')
    // One live invite per student and class: a resend replaces the old link.
    await prisma.emailLoginToken.deleteMany({ where: { pseudonym, kind: 'invite', classId: opts.classId } })
    await prisma.emailLoginToken.create({
      data: {
        pseudonym,
        kind: 'invite',
        tokenHash: inviteHash(token),
        classId: opts.classId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    })
    const url = `${baseUrl()}/auth/invite/${token}`
    const html = mailLayout('Class invitation', `
<h2 style="color: #374151; margin-top: 0;">You're invited to a class</h2>
<p><b>${teacher}</b> invites you to the class <b>${className}</b> on Eduskript.</p>
<div style="text-align: center; margin: 30px 0;">
  <a href="${url}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Join the class</a>
</div>
<p style="color: #6b7280; font-size: 14px;">The link is valid for 14 days. Later you can sign in at eduskript.org with this email address and a login code.</p>
<p style="color: #6b7280; font-size: 14px;">Eduskript doesn't store your email address. You can stop these invitations on the page the link opens.</p>`)
    const text = `${opts.teacherName || 'Your teacher'} invites you to the class "${opts.className.slice(0, 80)}" on Eduskript.\n\nJoin the class: ${url}\n\nThe link is valid for 14 days. Later you can sign in with this email address and a login code.\nEduskript doesn't store your email address. You can stop these invitations on the page the link opens.`

    await sendEmail({ to: email, subject: 'Class invitation on Eduskript', htmlContent: html, textContent: text, tag: 'class-invite' })
    await prisma.preAuthorizedStudent.updateMany({
      where: { classId: opts.classId, pseudonym },
      data: { invitedAt: new Date() },
    })
    sent.push(email)
  }

  for (let i = 0; i < queue.length; i += 5) {
    const results = await Promise.allSettled(queue.slice(i, i + 5).map(sendOne))
    failed += results.filter((r) => r.status === 'rejected').length
  }
  if (failed > 0) log.error(`Class invites: ${failed} of ${queue.length} failed (class ${opts.classId})`)

  return { sent, failed, optedOut: optOuts.size, limited }
}
