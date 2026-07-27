import { BrevoClient, BrevoError } from '@getbrevo/brevo'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const log = createLogger('email')

// Built lazily: the SDK validates the API key at construction, so a
// module-level client would throw at import time whenever BREVO_API_KEY is
// unset (tests, local dev, build-time module evaluation).
let client: BrevoClient | undefined
function getClient(apiKey: string): BrevoClient {
  client ??= new BrevoClient({ apiKey })
  return client
}

export interface EmailOptions {
  to: string | string[]
  subject: string
  htmlContent: string
  textContent?: string
  /** Brevo tag; also used for the X-Mailin-Tag header. */
  tag?: string
}

export async function sendEmail({ to, subject, htmlContent, textContent, tag = 'verification' }: EmailOptions) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured')
  }

  try {
    return await getClient(apiKey).transactionalEmails.sendTransacEmail({
      subject,
      htmlContent,
      textContent,
      sender: {
        name: process.env.EMAIL_FROM_NAME || 'Eduskript',
        email: process.env.EMAIL_FROM || 'noreply@localhost'
      },
      to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })),
      // Brevo-specific: suppress click tracking.
      tags: [tag, 'no-tracking'],
      headers: {
        'X-Mailin-Tag': tag,
        'List-Unsubscribe': '<mailto:unsubscribe@eduskript.org>'
      }
    })
  } catch (error) {
    // Surface Brevo's real response. BrevoError carries status + parsed body;
    // without unpacking them, IP-authorization blocks, SPF/DKIM failures, and
    // quota errors all collapse into an indistinguishable "Failed to send email".
    const status = error instanceof BrevoError ? error.statusCode : undefined
    const body = error instanceof BrevoError ? error.body : undefined
    const detail =
      typeof body === 'object' && body !== null
        ? JSON.stringify(body)
        : (body ?? (error as Error)?.message ?? String(error))
    log.error(`send failed (status ${status ?? 'unknown'}): ${detail}`)
    throw new Error(`Failed to send email: ${status ?? 'error'} ${detail}`)
  }
}

/**
 * Recipients for platform notifications: every user with `isAdmin = true` that
 * has a real email, overridable via ADMIN_NOTIFICATION_EMAILS (comma-separated).
 * The override wins outright — it does not merge with the DB admins.
 */
async function getAdminNotificationRecipients(): Promise<string[]> {
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