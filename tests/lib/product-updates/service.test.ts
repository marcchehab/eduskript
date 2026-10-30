import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    productUpdate: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    productUpdateSubscriber: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({})),
  getAdminNotificationRecipients: vi.fn(async () => ['admin@eduskript.org']),
}))

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import {
  approveAndClaim,
  discardDraft,
  sendClaimedDraft,
  setProductUpdates,
  createDraft,
} from '@/lib/product-updates/service'
import { signApproveToken, verifyUserToken } from '@/lib/product-updates/tokens'

const future = () => new Date(Date.now() + 60 * 60 * 1000)
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  subject: 'Neu: Kara-Welten',
  bodyHtml: '<html><body><p>Hallo</p></body></html>',
  bodyText: 'Hallo',
  fromAddr: 'marc@eduskript.org',
  status: 'pending',
  expiresAt: future(),
  ...over,
})

const teachers = [
  { id: 'u1', email: 'a@school.ch', name: 'Anna', sites: [{ pageLanguage: 'de-CH' }] },
  { id: 'u2', email: 'b@school.uk', name: 'Ben', sites: [{ pageLanguage: 'en-GB' }] },
]

describe('product-update approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.user.findMany).mockResolvedValue(teachers as never)
    vi.mocked(prisma.productUpdate.updateMany).mockResolvedValue({ count: 1 })
  })

  it('claims a pending draft with a valid token', async () => {
    const d = draft()
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    const res = await approveAndClaim('d1', signApproveToken('d1', d.expiresAt), 'admin1')
    expect(res).toMatchObject({ ok: true })
    expect(res.ok && res.recipients.map((r) => r.lang)).toEqual(['de', 'en'])
    expect(prisma.productUpdate.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'd1', status: 'pending' }),
      data: expect.objectContaining({ status: 'sending', approvedById: 'admin1', recipientCount: 2 }),
    })
  })

  it('only queries opted-in teachers', async () => {
    const d = draft()
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    await approveAndClaim('d1', signApproveToken('d1', d.expiresAt), 'admin1')
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where
    expect(JSON.stringify(where)).toContain('"productUpdates":true')
    expect(where).toMatchObject({ accountType: 'teacher', isTemporary: false })
  })

  it('rejects a wrong token', async () => {
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(draft() as never)
    expect(await approveAndClaim('d1', 'nope', 'admin1')).toEqual({ ok: false, reason: 'invalid-token' })
    expect(prisma.productUpdate.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an expired link', async () => {
    const d = draft({ expiresAt: new Date(Date.now() - 1000) })
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    expect(await approveAndClaim('d1', signApproveToken('d1', d.expiresAt), 'admin1')).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(prisma.productUpdate.updateMany).not.toHaveBeenCalled()
  })

  it('is single-use: an already claimed draft is not claimed again', async () => {
    const d = draft({ status: 'sending' })
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    expect(await approveAndClaim('d1', signApproveToken('d1', d.expiresAt), 'admin1')).toEqual({
      ok: false,
      reason: 'not-pending',
    })
  })

  it('loses the race when a concurrent click claimed it first', async () => {
    const d = draft()
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    vi.mocked(prisma.productUpdate.updateMany).mockResolvedValue({ count: 0 })
    expect(await approveAndClaim('d1', signApproveToken('d1', d.expiresAt), 'admin1')).toEqual({
      ok: false,
      reason: 'not-pending',
    })
  })

  it('discards only with a valid token', async () => {
    const d = draft()
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(d as never)
    expect(await discardDraft('d1', 'nope')).toBe(false)
    expect(await discardDraft('d1', signApproveToken('d1', d.expiresAt))).toBe(true)
    expect(prisma.productUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'pending' },
      data: expect.objectContaining({ status: 'discarded' }),
    })
  })
})

describe('product-update sending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends one individual mail per recipient with its own unsubscribe link', async () => {
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(draft({ status: 'sending' }) as never)
    const recipients = [
      { id: 'u1', email: 'a@school.ch', name: 'Anna', lang: 'de' as const, kind: 'user' as const },
      { id: 'u2', email: 'b@school.uk', name: 'Ben', lang: 'en' as const, kind: 'user' as const },
    ]
    const res = await sendClaimedDraft('d1', recipients, 0)
    expect(res).toEqual({ sent: 2, failed: 0 })

    const calls = vi.mocked(sendEmail).mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.to)).toEqual(['a@school.ch', 'b@school.uk'])
    for (const [i, c] of calls.entries()) {
      expect(c.from).toEqual({ name: 'Marc Chéhab', address: 'marc@eduskript.org' })
      expect(c.replyTo).toBe('marc@eduskript.org')
      expect(c.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
      const token = decodeURIComponent(/token=([^>&"]+)/.exec(c.headers!['List-Unsubscribe'])![1])
      expect(verifyUserToken('unsubscribe', token)).toBe(recipients[i].id)
      expect(c.htmlContent).toContain('/unsubscribe?token=')
      // Footer lands inside <body>.
      expect(c.htmlContent.indexOf('unsubscribe?token=')).toBeLessThan(c.htmlContent.indexOf('</body>'))
    }
    expect(calls[0].htmlContent).toContain('jederzeit')
    expect(calls[1].htmlContent).toContain('unsubscribe</a> at any time')
    expect(prisma.productUpdate.update).toHaveBeenLastCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'sent' }),
    })
  })

  it('counts failures and keeps going', async () => {
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(draft({ status: 'sending' }) as never)
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('550'))
    const res = await sendClaimedDraft(
      'd1',
      [
        { id: 'u1', email: 'a@school.ch', name: null, lang: 'de', kind: 'user' },
        { id: 'u2', email: 'b@school.ch', name: null, lang: 'de', kind: 'user' },
      ],
      0
    )
    expect(res).toEqual({ sent: 1, failed: 1 })
  })

  it('sends nothing for a draft that was not claimed', async () => {
    vi.mocked(prisma.productUpdate.findUnique).mockResolvedValue(draft({ status: 'pending' }) as never)
    expect(await sendClaimedDraft('d1', [{ id: 'u1', email: 'a@x.ch', name: null, lang: 'de', kind: 'user' }], 0)).toEqual({
      sent: 0,
      failed: 0,
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('mails admins a preview with an approve link when a draft is created', async () => {
    vi.mocked(prisma.productUpdate.create).mockResolvedValue(draft() as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue(teachers as never)
    await createDraft({ fromAddr: 'marc@eduskript.org', subject: 'Neu', bodyHtml: '<p>x</p>', bodyText: 'x' })
    const mail = vi.mocked(sendEmail).mock.calls[0][0]
    expect(mail.to).toEqual(['admin@eduskript.org'])
    expect(mail.htmlContent).toContain('/dashboard/admin/product-updates/d1?token=')
    expect(mail.htmlContent).toContain('would go to 2 recipients')
  })
})

describe('setProductUpdates', () => {
  it('stamps consent on opt-in and clears it on opt-out', async () => {
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: 'A@School.ch' } as never)
    await setProductUpdates('u1', true)
    expect(vi.mocked(prisma.user.updateMany).mock.calls[0][0]!.data).toMatchObject({ productUpdates: true })
    expect(vi.mocked(prisma.user.updateMany).mock.calls[0][0]!.data.productUpdatesConsentAt).toBeInstanceOf(Date)
    await setProductUpdates('u1', false)
    expect(vi.mocked(prisma.user.updateMany).mock.calls[1][0]!.data).toEqual({
      productUpdates: false,
      productUpdatesConsentAt: null,
    })
    // Opt-out also drops a guest subscription with the same address.
    expect(prisma.productUpdateSubscriber.deleteMany).toHaveBeenCalledWith({ where: { email: 'a@school.ch' } })
  })
})
