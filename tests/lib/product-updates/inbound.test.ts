import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/product-updates/service', () => ({
  createDraft: vi.fn(async () => ({ id: 'draft1' })),
}))

import { checkSender, handleProductUpdateMail, type DkimOutcome } from '@/lib/product-updates/inbound'
import { createDraft } from '@/lib/product-updates/service'

const RAW = Buffer.from(
  [
    'From: Marc Chéhab <marc@eduskript.org>',
    'To: inbox+tok@example.cloudmailin.net',
    'Subject: Neu in Eduskript',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hallo zusammen',
    '',
  ].join('\r\n')
)

const outcome = (over: Partial<DkimOutcome> = {}): DkimOutcome => ({
  headerFrom: ['marc@eduskript.org'],
  fromFields: 1,
  results: [{ signingDomain: 'eduskript.org', status: { result: 'pass' } }],
  ...over,
})

describe('product-update sender gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PRODUCT_UPDATE_SENDERS
  })
  afterEach(() => {
    delete process.env.PRODUCT_UPDATE_SENDERS
  })

  it('accepts an allowlisted sender with an aligned passing DKIM signature', async () => {
    const res = await checkSender(RAW, async () => outcome())
    expect(res).toEqual({ ok: true, from: 'marc@eduskript.org' })
  })

  it('accepts the second default sender (informatikgarten.ch)', async () => {
    const res = await checkSender(RAW, async () =>
      outcome({
        headerFrom: ['Marc@Informatikgarten.ch'],
        results: [{ signingDomain: 'informatikgarten.ch', status: { result: 'pass' } }],
      })
    )
    expect(res.ok).toBe(true)
  })

  it('rejects a sender that is not on the allowlist', async () => {
    const res = await checkSender(RAW, async () =>
      outcome({ headerFrom: ['eve@eduskript.org'] })
    )
    expect(res).toMatchObject({ ok: false, reason: 'sender-not-allowed' })
  })

  it('honours PRODUCT_UPDATE_SENDERS', async () => {
    process.env.PRODUCT_UPDATE_SENDERS = 'someone@eduskript.org'
    const res = await checkSender(RAW, async () => outcome())
    expect(res).toMatchObject({ ok: false, reason: 'sender-not-allowed' })
  })

  it('rejects failing DKIM', async () => {
    const res = await checkSender(RAW, async () =>
      outcome({ results: [{ signingDomain: 'eduskript.org', status: { result: 'fail' } }] })
    )
    expect(res).toMatchObject({ ok: false, reason: 'no-passing-dkim-for-sender-domain' })
  })

  it('rejects a passing signature from another domain', async () => {
    const res = await checkSender(RAW, async () =>
      outcome({ results: [{ signingDomain: 'attacker.example', status: { result: 'pass' } }] })
    )
    expect(res).toMatchObject({ ok: false, reason: 'no-passing-dkim-for-sender-domain' })
  })

  it('rejects a signature that leaves part of the body unsigned (l=)', async () => {
    const res = await checkSender(RAW, async () =>
      outcome({ results: [{ signingDomain: 'eduskript.org', status: { result: 'pass', underSized: 120 } }] })
    )
    expect(res.ok).toBe(false)
  })

  it('rejects messages without exactly one From', async () => {
    expect((await checkSender(RAW, async () => outcome({ fromFields: 2 }))).ok).toBe(false)
    expect((await checkSender(RAW, async () => outcome({ headerFrom: [] }))).ok).toBe(false)
  })

  it('rejects when DKIM verification throws', async () => {
    const res = await checkSender(RAW, async () => {
      throw new Error('dns down')
    })
    expect(res.ok).toBe(false)
  })

  it('stores a draft only when the gate passes', async () => {
    const rejected = await handleProductUpdateMail(RAW, async () =>
      outcome({ results: [{ signingDomain: 'eduskript.org', status: { result: 'fail' } }] })
    )
    expect(rejected.status).toBe('rejected')
    expect(createDraft).not.toHaveBeenCalled()

    const stored = await handleProductUpdateMail(RAW, async () => outcome())
    expect(stored).toEqual({ status: 'stored', draftId: 'draft1' })
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ fromAddr: 'marc@eduskript.org', subject: 'Neu in Eduskript' })
    )
  })
})
