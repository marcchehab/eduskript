/**
 * MailMessage storage helpers shared by the webhook (write) and surfaces (read).
 * TTL'd rows are purged opportunistically here so no cron is needed — the
 * login-code table stays tiny on its own.
 */

import { prisma } from '@/lib/prisma'

/** Delete this hook's expired (TTL'd) messages. Persistent rows are untouched. */
export async function purgeExpired(hookId: string): Promise<void> {
  await prisma.mailMessage.deleteMany({
    where: { hookId, expiresAt: { not: null, lt: new Date() } },
  })
}

/**
 * Active login codes for a hook, newest first, with seconds-until-expiry.
 * Purges expired rows first so callers never see stale codes.
 */
export async function getActiveCodes(
  hookId: string
): Promise<Array<{ code: string; expiresIn: number }>> {
  await purgeExpired(hookId)
  const now = Date.now()
  const rows = await prisma.mailMessage.findMany({
    where: {
      hookId,
      expiresAt: { gt: new Date() },
      extracted: { not: undefined },
    },
    orderBy: { createdAt: 'desc' },
    select: { extracted: true, expiresAt: true },
  })
  return rows
    .map((r) => {
      const code = (r.extracted as { code?: unknown } | null)?.code
      if (typeof code !== 'string') return null
      const expiresIn = r.expiresAt
        ? Math.max(0, Math.round((r.expiresAt.getTime() - now) / 1000))
        : 0
      return { code, expiresIn }
    })
    .filter((c): c is { code: string; expiresIn: number } => c !== null)
}
