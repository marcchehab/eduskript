import nodemailer, { type Transporter } from 'nodemailer'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const log = createLogger('email')

// Transactional mail goes out over plain SMTP (Infomaniak, mail.infomaniak.com,
// as EMAIL_FROM = noreply@eduskript.org). No provider-side open/click tracking:
// the message is delivered exactly as built here. Infomaniak caps the sending
// address at 200 recipients per rolling 24 h (Mail Starter).
// Product-update mails reuse sendEmail with a `from` override (src/lib/product-updates/).
//
// Built lazily so a missing SMTP_PASSWORD only fails when a mail is sent
// (tests, local dev, build-time module evaluation).
let transporter: Transporter | undefined
function getTransporter(password: string): Transporter {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER || process.env.EMAIL_FROM, pass: password },
  })
  return transporter
}

export interface EmailOptions {
  to: string | string[]
  subject: string
  htmlContent: string
  textContent?: string
  /** Kind of mail (verification, trial, admin…); only used in error logs. */
  tag?: string
  /** Overrides EMAIL_FROM_NAME (the address stays EMAIL_FROM, the authenticated sender). */
  senderName?: string
  /**
   * Overrides the whole From (name + address). The SMTP login (SMTP_USER) must
   * be allowed to send as that address — Infomaniak rejects anything else.
   */
  from?: { name: string; address: string }
  replyTo?: string
  /** Extra headers, e.g. List-Unsubscribe for product updates. */
  headers?: Record<string, string>
}

export async function sendEmail({ to, subject, htmlContent, textContent, tag = 'verification', senderName, from, replyTo, headers }: EmailOptions) {
  const password = process.env.SMTP_PASSWORD
  if (!password) {
    throw new Error('SMTP_PASSWORD is not configured')
  }

  try {
    return await getTransporter(password).sendMail({
      from: from ?? { name: senderName || process.env.EMAIL_FROM_NAME || 'Eduskript', address: process.env.EMAIL_FROM || 'noreply@localhost' },
      to: Array.isArray(to) ? to : [to],
      ...(replyTo ? { replyTo } : {}),
      subject,
      html: htmlContent,
      ...(textContent ? { text: textContent } : {}),
      ...(headers ? { headers } : {}),
    })
  } catch (error) {
    // SMTP errors carry the server's response code (e.g. 535 auth, 550 quota).
    const code = (error as { responseCode?: number })?.responseCode
    const detail = (error as Error)?.message ?? String(error)
    log.error(`send failed (${tag}, smtp ${code ?? 'unknown'}): ${detail}`)
    throw new Error(`Failed to send email: ${code ?? 'error'} ${detail}`)
  }
}

/**
 * Recipients for platform notifications: every user with `isAdmin = true` that
 * has a real email, overridable via ADMIN_NOTIFICATION_EMAILS (comma-separated).
 * The override wins outright — it does not merge with the DB admins.
 */
export async function getAdminNotificationRecipients(): Promise<string[]> {
  const override = process.env.ADMIN_NOTIFICATION_EMAILS
  if (override) {
    return override.split(',').map((e) => e.trim()).filter(Boolean)
  }

  const admins = await prisma.user.findMany({
    where: { isAdmin: true, email: { not: null } },
    select: { email: true },
  })

  // Students carry synthetic @eduskript.local addresses; never mail those.
  return admins
    .map((a) => a.email!)
    .filter((email) => !email.endsWith('@eduskript.local'))
}

export interface NewTeacherNotification {
  name: string | null
  email: string
  pageSlug: string | null
  /** How the account was created — 'email' still needs email verification. */
  method: 'email' | 'oauth'
  provider?: string
}

/**
 * Notify platform admins that a teacher account was created. Fires at account
 * creation, so email/password signups are reported *before* the address is
 * verified — the body says so. Never throws: signup must not fail because a
 * notification could not be sent.
 */
export async function notifyAdminsOfNewTeacher(teacher: NewTeacherNotification): Promise<void> {
  try {
    const recipients = await getAdminNotificationRecipients()
    if (recipients.length === 0) return

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const verification =
      teacher.method === 'oauth'
        ? `OAuth${teacher.provider ? ` (${teacher.provider})` : ''} — email verified by provider`
        : 'Email/password — email verification pending'

    const rows: [string, string][] = [
      ['Name', teacher.name || '—'],
      ['Email', teacher.email],
      ['Page', teacher.pageSlug ? `${baseUrl}/${teacher.pageSlug}` : 'not claimed yet'],
      ['Signup', verification],
    ]

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2563eb; margin-bottom: 16px;">New teacher signup</h2>
        <table style="border-collapse: collapse;">
          ${rows
            .map(
              ([label, value]) => `
            <tr>
              <td style="padding: 4px 16px 4px 0; color: #6b7280;">${label}</td>
              <td style="padding: 4px 0;">${value}</td>
            </tr>`
            )
            .join('')}
        </table>
        <p style="margin-top: 24px;">
          <a href="${baseUrl}/dashboard/admin" style="color: #2563eb;">Open admin dashboard</a>
        </p>
      </div>
    `

    const textContent = `New teacher signup\n\n${rows
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n')}\n\n${baseUrl}/dashboard/admin\n`

    await sendEmail({
      to: recipients,
      subject: `New teacher signup: ${teacher.email}`,
      htmlContent,
      textContent,
      tag: 'admin-notification',
    })
  } catch (error) {
    log.error(`admin new-teacher notification failed: ${(error as Error)?.message ?? String(error)}`)
  }
}

export function generateVerificationEmailContent(
  verificationUrl: string
): { htmlContent: string; textContent: string } {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
        <h1 style="color: #2563eb; margin: 0; font-size: 28px;">Welcome to Eduskript!</h1>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 10px; border: 1px solid #e5e7eb;">
        <h2 style="color: #374151; margin-top: 0;">Verify Your Email Address</h2>
        
        <p>Hi there!</p>
        
        <p>Thank you for signing up for Eduskript. To complete your registration and start using your account, please verify your email address by clicking the button below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        
        <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #6b7280; font-size: 14px;">${verificationUrl}</p>
        
        <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
          This verification link will expire in 24 hours. If you didn't create an account with us, you can safely ignore this email.
        </p>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Eduskript. All rights reserved.</p>
      </div>
    </body>
    </html>
  `

  const textContent = `
Welcome to Eduskript!

Thank you for signing up. To complete your registration, please verify your email address by visiting:

${verificationUrl}

This verification link will expire in 24 hours. If you didn't create an account with us, you can safely ignore this email.

© ${new Date().getFullYear()} Eduskript. All rights reserved.
  `

  return { htmlContent, textContent }
}