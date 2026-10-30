// @vitest-environment node
/**
 * The sender gate against the real mailauth verifier: messages signed here
 * with a throwaway key, DNS answered by a stub resolver.
 */
import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { dkimSign, dkimVerify } from 'mailauth'

vi.mock('@/lib/product-updates/service', () => ({ createDraft: vi.fn() }))

import { checkSender } from '@/lib/product-updates/inbound'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

const resolver = async (name: string, rrtype: string) => {
  if (rrtype === 'TXT' && name === 'sel._domainkey.eduskript.org') return [[`v=DKIM1; k=rsa; p=${publicB64}`]]
  const err = new Error('not found') as Error & { code: string }
  err.code = 'ENOTFOUND'
  throw err
}
const verify = (raw: Buffer) => dkimVerify(raw, { resolver }) as never

function message(from: string, body = 'Hallo zusammen\r\n') {
  return [
    `From: ${from}`,
    'To: inbox+tok@example.cloudmailin.net',
    'Subject: Neu in Eduskript',
    'Date: Fri, 30 Oct 2026 08:00:00 +0100',
    'Message-ID: <1@eduskript.org>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
}

async function signed(msg: string, signingDomain = 'eduskript.org') {
  const { signatures } = await dkimSign(msg, {
    signatureData: [{ signingDomain, selector: 'sel', privateKey: privatePem }],
  })
  return signatures + msg
}

describe('product-update sender gate (real DKIM)', () => {
  it('accepts a correctly signed mail from an allowlisted sender', async () => {
    const raw = Buffer.from(await signed(message('Marc <marc@eduskript.org>')))
    expect(await checkSender(raw, verify)).toEqual({ ok: true, from: 'marc@eduskript.org' })
  })

  it('rejects a signed mail whose body was changed afterwards', async () => {
    const original = await signed(message('Marc <marc@eduskript.org>'))
    const tampered = original.replace('Hallo zusammen', 'Bitte hier klicken')
    expect((await checkSender(Buffer.from(tampered), verify)).ok).toBe(false)
  })

  it('rejects an unsigned mail', async () => {
    const raw = Buffer.from(message('Marc <marc@eduskript.org>'))
    expect(await checkSender(raw, verify)).toMatchObject({ ok: false, reason: 'no-passing-dkim-for-sender-domain' })
  })
})
