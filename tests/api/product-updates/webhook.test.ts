// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mailHook: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    mailMessage: { create: vi.fn(async () => ({ id: 'm1' })), deleteMany: vi.fn() },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  mailWebhookRateLimiter: { check: vi.fn(() => ({ allowed: true })) },
  getClientIdentifier: vi.fn(() => 'ip'),
}))
vi.mock('@/lib/product-updates/inbound', () => ({
  handleProductUpdateMail: vi.fn(async () => ({ status: 'stored', draftId: 'd1' })),
}))

import { POST } from '@/app/api/webhooks/mail/route'
import { prisma } from '@/lib/prisma'
import { handleProductUpdateMail } from '@/lib/product-updates/inbound'

const RAW = [
  'From: Marc <marc@eduskript.org>',
  'To: inbox+PRODTOKEN@x.cloudmailin.net',
  'Subject: Neu',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<h1>123456</h1>',
  '',
].join('\r\n')

function rawRequest(to: string, message = RAW) {
  const form = new FormData()
  form.set('message', message)
  form.set('envelope[to]', to)
  form.set('envelope[from]', 'marc@eduskript.org')
  return new NextRequest('http://localhost:3000/api/webhooks/mail?secret=s3cret', { method: 'POST', body: form })
}

describe('mail webhook: product-update routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CLOUDMAILIN_SECRET = 's3cret'
    process.env.PRODUCT_UPDATE_MAIL_TOKEN = 'PRODTOKEN'
  })

  it('hands the raw message of a product-update mail to the inbound gate', async () => {
    const res = await POST(rawRequest('inbox+PRODTOKEN@x.cloudmailin.net'))
    expect(res.status).toBe(200)
    expect(handleProductUpdateMail).toHaveBeenCalledTimes(1)
    const raw = vi.mocked(handleProductUpdateMail).mock.calls[0][0]
    expect(raw.toString('utf8')).toBe(RAW)
    expect(prisma.mailHook.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a product-update mail in the JSON format (no raw message to verify)', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/mail?secret=s3cret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope: { to: 'inbox+PRODTOKEN@x.cloudmailin.net' }, headers: { subject: 'x' }, plain: 'x' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe('raw-format-required')
    expect(handleProductUpdateMail).not.toHaveBeenCalled()
  })

  it('still routes login-code hooks from the raw format', async () => {
    vi.mocked(prisma.mailHook.findUnique).mockResolvedValue({
      id: 'h1', token: 'hooktok', mode: 'login-code', parserConfig: null, ttlMinutes: 15, label: 'x',
    } as never)
    const res = await POST(rawRequest('inbox+hooktok@x.cloudmailin.net'))
    expect(res.status).toBe(200)
    expect(handleProductUpdateMail).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mailMessage.create).mock.calls[0][0].data).toMatchObject({
      hookId: 'h1',
      subject: 'Neu',
      extracted: { code: '123456' },
    })
  })
})
