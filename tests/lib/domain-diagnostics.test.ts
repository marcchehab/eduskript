import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const resolveTxt = vi.fn()
const resolveCname = vi.fn()
const resolve4 = vi.fn()
const resolve6 = vi.fn()

vi.mock('dns', () => {
  const promises = {
    resolveTxt: (...args: unknown[]) => resolveTxt(...args),
    resolveCname: (...args: unknown[]) => resolveCname(...args),
    resolve4: (...args: unknown[]) => resolve4(...args),
    resolve6: (...args: unknown[]) => resolve6(...args),
  }
  return { promises, default: { promises } }
})

const { diagnoseDomain } = await import('@/lib/domain-diagnostics')
const { CUSTOM_DOMAIN_TARGET } = await import('@/lib/custom-domains')

const TOKEN = 'a'.repeat(64)

function dnsError(code: string) {
  return Object.assign(new Error(code), { code })
}

function byId(checks: Awaited<ReturnType<typeof diagnoseDomain>>['checks']) {
  return Object.fromEntries(checks.map(c => [c.id, c]))
}

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function healthyResponse() {
  return new Response(JSON.stringify({ status: 'healthy' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('diagnoseDomain', () => {
  beforeEach(() => {
    resolveTxt.mockReset()
    resolveCname.mockReset()
    resolve4.mockReset().mockRejectedValue(dnsError('ENODATA'))
    resolve6.mockReset().mockRejectedValue(dnsError('ENODATA'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes every check for a fully configured domain', async () => {
    resolveTxt.mockResolvedValue([[TOKEN]])
    resolveCname.mockResolvedValue([`${CUSTOM_DOMAIN_TARGET}.`])
    mockFetch(() => healthyResponse())

    const { checks } = await diagnoseDomain({
      domain: 'kurse.example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    expect(checks.every(c => c.status === 'ok')).toBe(true)
  })

  it('fails routing when the CNAME points somewhere else', async () => {
    resolveCname.mockResolvedValue(['other-host.example.net.'])
    mockFetch(() => new Response('', { status: 404 }))

    const { checks } = await diagnoseDomain({
      domain: 'kurse.example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    const routing = byId(checks).routing
    expect(routing.status).toBe('fail')
    expect(routing.detail).toContain('other-host.example.net')
  })

  it('accepts a root domain with no visible CNAME when HTTPS serves the app', async () => {
    resolveCname.mockRejectedValue(dnsError('ENODATA'))
    resolve4.mockResolvedValue(['104.20.31.27'])
    mockFetch(() => healthyResponse())

    const { checks } = await diagnoseDomain({
      domain: 'example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    expect(byId(checks).routing.status).toBe('ok')
  })

  it('warns about the proxy when no CNAME is visible and HTTPS does not serve the app', async () => {
    resolveCname.mockRejectedValue(dnsError('ENODATA'))
    resolve4.mockResolvedValue(['104.20.31.27'])
    mockFetch(() => new Response('', { status: 403 }))

    const { checks } = await diagnoseDomain({
      domain: 'example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    const results = byId(checks)
    expect(results.routing.status).toBe('warn')
    expect(results.routing.hint).toContain('DNS only')
    // 403 from the edge = TLS terminates but no route exists for the hostname
    expect(results.https.status).toBe('warn')
    expect(results.https.hint).toContain('activation')
  })

  it('fails routing and HTTPS when the domain does not resolve', async () => {
    resolveCname.mockRejectedValue(dnsError('ENOTFOUND'))
    mockFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    })

    const { checks } = await diagnoseDomain({
      domain: 'nope.example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    const results = byId(checks)
    expect(results.routing.status).toBe('fail')
    expect(results.https.status).toBe('fail')
  })

  it('reports a TLS failure as a certificate problem', async () => {
    resolveCname.mockResolvedValue([`${CUSTOM_DOMAIN_TARGET}.`])
    mockFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } })
    })

    const { checks } = await diagnoseDomain({
      domain: 'kurse.example.com',
      verificationToken: TOKEN,
      isVerified: true,
    })

    const https = byId(checks).https
    expect(https.status).toBe('fail')
    expect(https.detail).toContain('TLS handshake failed')
  })

  it('flags an unverified domain and a missing TXT record', async () => {
    resolveTxt.mockRejectedValue(dnsError('ENOTFOUND'))
    resolveCname.mockResolvedValue([`${CUSTOM_DOMAIN_TARGET}.`])
    mockFetch(() => new Response('', { status: 404 }))

    const { checks } = await diagnoseDomain({
      domain: 'kurse.example.com',
      verificationToken: TOKEN,
      isVerified: false,
    })

    const results = byId(checks)
    expect(results.ownership.status).toBe('fail')
    expect(results.activation.status).toBe('fail')
  })

  it('flags a TXT record whose value does not match', async () => {
    resolveTxt.mockResolvedValue([['wrong-value']])
    resolveCname.mockResolvedValue([`${CUSTOM_DOMAIN_TARGET}.`])
    mockFetch(() => new Response('', { status: 404 }))

    const { checks } = await diagnoseDomain({
      domain: 'kurse.example.com',
      verificationToken: TOKEN,
      isVerified: false,
    })

    const ownership = byId(checks).ownership
    expect(ownership.status).toBe('fail')
    expect(ownership.detail).toContain('wrong-value')
  })
})
