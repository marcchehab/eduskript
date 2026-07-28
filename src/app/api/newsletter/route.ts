/**
 * Newsletter subscription.
 *
 * POST /api/newsletter  { email, pageId, listId? }
 *
 * The list belongs to the site the page sits on, provisioned on first use —
 * see src/lib/newsletter.ts for why the id is stored rather than derived, and
 * why subscribers live in Brevo rather than here.
 *
 * Single opt-in by choice: the address joins the list immediately, with no
 * confirmation mail.
 *
 * Deliberately unauthenticated: it is a public signup box. Rate limited by IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { BrevoError } from '@getbrevo/brevo'
import { RateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { getBrevoClient, resolveListId } from '@/lib/newsletter'
import { createLogger } from '@/lib/logger'

const log = createLogger('newsletter')

const rateLimiter = new RateLimiter('newsletter', {
  interval: 60 * 60 * 1000,
  maxRequests: 5,
})

// Enough to reject obvious rubbish; Brevo does the real validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The skript's site, via the first collection the skript sits in. */
const SKRIPT_SITE_SELECT = {
  collectionSkripts: {
    take: 1,
    orderBy: { order: 'asc' as const },
    select: { collection: { select: { siteId: true } } },
  },
}

/**
 * The site the box was rendered on.
 *
 * The id can name either a Page or a FrontPage: site and skript frontpages are
 * FrontPage records, and the renderers pass their id as `pageId` (see
 * src/app/[domain]/page.tsx). Two lookups rather than one because the ids live
 * in separate tables; the FrontPage query only runs when the Page misses.
 */
async function siteIdForPage(pageId: string): Promise<string | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { skript: { select: SKRIPT_SITE_SELECT } },
  })
  if (page) return page.skript?.collectionSkripts[0]?.collection?.siteId ?? null

  // Site frontpage: siteId directly. Skript frontpage: via its skript.
  const frontPage = await prisma.frontPage.findUnique({
    where: { id: pageId },
    select: { siteId: true, skript: { select: SKRIPT_SITE_SELECT } },
  })
  return (
    frontPage?.siteId ?? frontPage?.skript?.collectionSkripts[0]?.collection?.siteId ?? null
  )
}

export async function POST(request: NextRequest) {
  const rate = rateLimiter.check(getClientIdentifier(request))
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter ?? 3600) } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { email, pageId, listId } = (body ?? {}) as {
    email?: unknown
    pageId?: unknown
    listId?: unknown
  }

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  if (typeof pageId !== 'string' || !pageId) {
    return NextResponse.json({ error: 'The newsletter is not available here.' }, { status: 400 })
  }

  const siteId = await siteIdForPage(pageId)
  if (!siteId) {
    return NextResponse.json({ error: 'The newsletter is not available here.' }, { status: 404 })
  }

  const requested = Number(listId)
  const list = await resolveListId(siteId, Number.isInteger(requested) && requested > 0 ? requested : undefined)
  const client = getBrevoClient()

  if (!list || !client) {
    return NextResponse.json(
      { error: 'The newsletter is not available right now.' },
      { status: 503 }
    )
  }

  try {
    await client.contacts.createContact({
      email: email.trim(),
      listIds: [list],
      updateEnabled: true,
    })
    return NextResponse.json({ ok: true, message: 'You are subscribed. Welcome!' })
  } catch (error) {
    // An address already on the list comes back as a 400 duplicate_parameter.
    // Saying so would leak who is subscribed, so it reads as success.
    const status = error instanceof BrevoError ? error.statusCode : undefined
    const detail = error instanceof BrevoError ? JSON.stringify(error.body) : String(error)

    if (status === 400 && detail.includes('duplicate_parameter')) {
      return NextResponse.json({ ok: true, message: 'You are subscribed. Welcome!' })
    }

    log.error(`subscribe failed (status ${status ?? 'unknown'}): ${detail.slice(0, 300)}`)
    return NextResponse.json(
      { error: 'Could not subscribe right now. Please try again later.' },
      { status: 502 }
    )
  }
}
