import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    productUpdate: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    productUpdateSubscriber: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({})),
  getAdminNotificationRecipients: vi.fn(async () => []),
}))

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import {
  GUEST_CONFIRM_TTL_MS,
  confirmGuest,
  dedupeRecipients,
  getRecipients,
  requestGuestSubscription,
  sendClaimedDraft,
  unsubscribeGuest,
} from '@/lib/product-updates/service'
import { verifyUserToken } from '@/lib/product-updates/tokens'

const sub = prisma.productUpdateSubscriber

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sub.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 })
})

describe('requestGuestSubscription', () => {
  it('stores an unconfirmed row (lowercased) and mails a guest-confirm link', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue(null)
    vi.mocked(sub.upsert).mockResolvedValue({ id: 's1' } as never)
    expect(await requestGuestSubscription(' Anna@School.CH ', 'de')).toBe('confirmation-sent')

    expect(sub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'anna@school.ch' }, create: { email: 'anna@school.ch', lang: 'de' } })
    )
    const mail = vi.mocked(sendEmail).mock.calls[0][0]
    expect(mail.to).toBe('anna@school.ch')
    expect(mail.subject).toContain('bestätigen')
    const token = decodeURIComponent(/\/subscribe\?token=([^"&\s]+)/.exec(mail.htmlContent)![1])
    expect(verifyUserToken('guest-confirm', token)).toBe('s1')
    // A confirm token is not a teacher subscribe token.
    expect(verifyUserToken('subscribe', token)).toBeNull()
  })

  it('purges unconfirmed rows older than 7 days', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue(null)
    vi.mocked(sub.upsert).mockResolvedValue({ id: 's1' } as never)
    const before = Date.now()
    await requestGuestSubscription('a@x.ch', 'en')
    const where = vi.mocked(sub.deleteMany).mock.calls[0][0]!.where as { confirmedAt: null; createdAt: { lt: Date } }
    expect(where.confirmedAt).toBeNull()
    expect(Math.abs(where.createdAt.lt.getTime() - (before - GUEST_CONFIRM_TTL_MS))).toBeLessThan(5000)
  })

  it('sends nothing for an already confirmed guest', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue({ confirmedAt: new Date() } as never)
    expect(await requestGuestSubscription('a@x.ch', 'en')).toBe('already-subscribed')
    expect(sub.upsert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when an opted-in teacher has the address', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'u1' } as never)
    expect(await requestGuestSubscription('a@x.ch', 'en')).toBe('already-subscribed')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('confirmGuest', () => {
  it('marks a fresh row confirmed', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue({ id: 's1', email: 'a@x.ch', confirmedAt: null, createdAt: new Date() } as never)
    expect(await confirmGuest('s1')).toBe(true)
    expect(sub.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { confirmedAt: expect.any(Date) } })
  })

  it('rejects and deletes an expired unconfirmed row', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue({
      id: 's1',
      email: 'a@x.ch',
      confirmedAt: null,
      createdAt: new Date(Date.now() - GUEST_CONFIRM_TTL_MS - 1000),
    } as never)
    expect(await confirmGuest('s1')).toBe(false)
    expect(sub.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(sub.update).not.toHaveBeenCalled()
  })

  it('returns false for an unknown row', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue(null)
    expect(await confirmGuest('nope')).toBe(false)
  })

  it('sets the teacher flag instead of keeping a guest row when the address is a teacher', async () => {
    vi.mocked(sub.findUnique).mockResolvedValue({ id: 's1', email: 'a@x.ch', confirmedAt: null, createdAt: new Date() } as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'u1' } as never)
    expect(await confirmGuest('s1')).toBe(true)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { productUpdates: true, productUpdatesConsentAt: expect.any(Date) },
    })
    expect(sub.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(sub.update).not.toHaveBeenCalled()
  })
})

describe('unsubscribeGuest', () => {
  it('deletes the row', async () => {
    await unsubscribeGuest('s1')
    expect(sub.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
  })
})

describe('recipients', () => {
  it('merges teachers and confirmed guests, deduplicated by lowercased email, teacher first', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u1', email: 'Anna@School.ch', name: 'Anna', sites: [{ pageLanguage: 'de-CH' }] },
    ] as never)
    vi.mocked(sub.findMany).mockResolvedValue([
      { id: 's1', email: 'anna@school.ch', lang: 'en' },
      { id: 's2', email: 'guest@x.ch', lang: 'de' },
    ] as never)
    const r = await getRecipients()
    expect(r.map((x) => [x.id, x.kind, x.lang])).toEqual([
      ['u1', 'user', 'de'],
      ['s2', 'guest', 'de'],
    ])
    expect(vi.mocked(sub.findMany).mock.calls[0][0]!.where).toEqual({ confirmedAt: { not: null } })
  })

  it('dedupeRecipients keeps the first per address', () => {
    const r = dedupeRecipients([
      { id: 'a', email: 'X@y.ch', name: null, lang: 'de', kind: 'user' },
      { id: 'b', email: 'x@Y.ch', name: null, lang: 'en', kind: 'guest' },
    ])
    expect(r.map((x) => x.id)).toEqual(['a'])
  })

  it('guests get a guest-unsubscribe link and List-Unsubscribe header', async () => {
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue({
      id: 'd1',
      subject: 'Neu',
      bodyHtml: '<html><body><p>Hallo</p></body></html>',
      bodyText: 'Hallo',
      status: 'sending',
    } as never)
    await sendClaimedDraft('d1', [{ id: 's2', email: 'guest@x.ch', name: null, lang: 'de', kind: 'guest' }], 0)
    const mail = vi.mocked(sendEmail).mock.calls[0][0]
    const token = decodeURIComponent(/token=([^>&"]+)/.exec(mail.headers!['List-Unsubscribe'])![1])
    expect(verifyUserToken('guest-unsubscribe', token)).toBe('s2')
    expect(verifyUserToken('unsubscribe', token)).toBeNull()
    expect(mail.htmlContent).toContain('jederzeit')
  })
})
