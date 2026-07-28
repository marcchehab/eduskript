/**
 * Newsletter lists, one per site.
 *
 * Subscribers live in Brevo, not in our database: Brevo already sends this
 * app's mail and owns what a list actually needs — the confirmation mail, the
 * unsubscribe link, bounce handling, export and deletion on request. All we
 * keep is which list belongs to which site.
 *
 * The list is provisioned on the first subscription to a site that has none,
 * so a teacher can drop <newsletter /> on a page and it works. Its id is
 * stored in Site.extraSettings.newsletterListId — stored, not derived from the
 * slug, because Brevo list names are not stable identifiers and a slug rename
 * would otherwise orphan every subscriber.
 */

import { BrevoClient } from '@getbrevo/brevo'
import { prisma } from '@/lib/prisma'
import { readExtraSettings, mergeExtraSettings } from '@/lib/settings'
import { createLogger } from '@/lib/logger'

const log = createLogger('newsletter')

export function getBrevoClient(): BrevoClient | null {
  const apiKey = process.env.BREVO_API_KEY
  return apiKey ? new BrevoClient({ apiKey }) : null
}

/**
 * The Brevo list for a site, created if this is the first subscriber.
 *
 * Concurrent first-subscribes could each create a list; the loser's id is
 * overwritten and its (empty) list is left behind in Brevo. Not worth locking
 * for — the window is one API call wide and only ever hits a brand-new list.
 */
export async function getOrCreateSiteList(siteId: string): Promise<number | null> {
  const client = getBrevoClient()
  if (!client) {
    log.error('BREVO_API_KEY is not configured')
    return null
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { slug: true, pageName: true, extraSettings: true },
  })
  if (!site) return null

  const existing = readExtraSettings(site.extraSettings).newsletterListId
  if (existing) return existing

  try {
    // Brevo requires every list to sit in a folder; folder 1 is the default
    // one every account is created with.
    const folderId = Number(process.env.BREVO_NEWSLETTER_FOLDER_ID) || 1
    const created = await client.contacts.createList({
      name: `Eduskript — ${site.pageName || site.slug}`,
      folderId,
    })

    const listId = Number(created.id)
    if (!Number.isInteger(listId) || listId <= 0) {
      log.error(`Brevo returned no usable list id for site ${siteId}`)
      return null
    }

    await prisma.site.update({
      where: { id: siteId },
      data: { extraSettings: mergeExtraSettings(site.extraSettings, { newsletterListId: listId }) },
    })

    log.info(`Provisioned newsletter list ${listId} for site ${site.slug}`)
    return listId
  } catch (error) {
    log.error(`Failed to create list for site ${siteId}: ${String(error).slice(0, 300)}`)
    return null
  }
}

/**
 * Resolve the list a subscription should join.
 *
 * An explicit list-id on the <newsletter> tag is only honoured when it is the
 * one that site already owns. The ids are small sequential integers shared
 * across the whole Brevo account, so an unchecked override would let any page
 * subscribe addresses into any other teacher's list.
 */
export async function resolveListId(
  siteId: string,
  requestedListId?: number
): Promise<number | null> {
  const listId = await getOrCreateSiteList(siteId)
  if (!listId) return null

  if (requestedListId !== undefined && requestedListId !== listId) {
    log.warn(`Site ${siteId} requested list ${requestedListId}; it owns ${listId}. Using its own.`)
  }

  return listId
}
