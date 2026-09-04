/**
 * Product-update mailing lists for teacher accounts, one per language,
 * maintained automatically in Brevo.
 *
 * Two lists, created ONCE by hand in Brevo and pinned via env:
 *   BREVO_TEACHER_LIST_EN / BREVO_TEACHER_LIST_DE (numeric list ids).
 * With either unset the sync is a silent no-op, so dev environments and
 * fresh deployments don't need Brevo.
 *
 * A teacher belongs on the German list when any of their sites has a German
 * pageLanguage, else the English list. syncTeacherProductList moves the
 * contact between the two on every call, so it is safe (and expected) to call
 * it again whenever the answer may have changed: registration, profile
 * completion, site-language change. Unsubscribes are Brevo's job — a contact
 * who opted out stays a list member but is excluded from sends, and re-adding
 * them does not undo the opt-out.
 *
 * Related: src/lib/newsletter.ts (per-site subscriber lists, same client).
 */

import { prisma } from '@/lib/prisma'
import { getBrevoClient } from '@/lib/newsletter'
import { createLogger } from '@/lib/logger'

const log = createLogger('teacher-list')

function listIds(): { en: number; de: number } | null {
  const en = Number(process.env.BREVO_TEACHER_LIST_EN)
  const de = Number(process.env.BREVO_TEACHER_LIST_DE)
  if (!Number.isInteger(en) || en <= 0 || !Number.isInteger(de) || de <= 0) return null
  return { en, de }
}

/**
 * Put the teacher on the product-update list matching their language and take
 * them off the other one. No-op for students, temporary users, users without
 * an email, and when the list ids are not configured. Never throws — callers
 * fire-and-forget from signup/settings paths where Brevo being down must not
 * break the request.
 */
export async function syncTeacherProductList(userId: string): Promise<void> {
  try {
    const ids = listIds()
    const client = getBrevoClient()
    if (!ids || !client) return

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        accountType: true,
        isTemporary: true,
        sites: { select: { pageLanguage: true } },
      },
    })
    if (!user || !user.email || user.accountType !== 'teacher' || user.isTemporary) return

    const isGerman = user.sites.some(s => s.pageLanguage?.toLowerCase().startsWith('de'))
    const target = isGerman ? ids.de : ids.en
    const other = isGerman ? ids.en : ids.de
    const email = user.email

    // Upsert the contact onto the target list…
    await client.contacts.createContact({
      email,
      attributes: user.name ? { FIRSTNAME: user.name } : undefined,
      listIds: [target],
      updateEnabled: true,
    })
    // …and off the other one. A contact who was never on it comes back as an
    // error from Brevo; that's the common case, so swallow it.
    await client.contacts
      .removeContactFromList({ listId: other, body: { emails: [email] } })
      .catch(() => {})

    log.info(`Synced teacher ${userId} to ${isGerman ? 'DE' : 'EN'} product list`)
  } catch (error) {
    log.error(`Product-list sync failed for user ${userId}: ${String(error).slice(0, 300)}`)
  }
}
