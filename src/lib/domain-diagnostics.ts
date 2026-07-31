/**
 * End-to-end configuration check for a custom domain.
 *
 * The verify endpoints only look at the ownership TXT record. That leaves the
 * common failure modes invisible: no CNAME at all, a CNAME to the wrong host,
 * a Cloudflare proxy in front of it (which blocks certificate issuance), or a
 * domain that resolves but serves something other than this app.
 *
 * Cost per run: up to 3 DNS lookups plus one outbound HTTPS request to the
 * user's domain. Callers must authenticate and scope to domains the caller
 * owns — this makes the server fetch an arbitrary hostname otherwise.
 */

import { promises as dns } from 'dns'
import { CUSTOM_DOMAIN_TARGET, VERIFICATION_HOST_PREFIX } from '@/lib/custom-domains'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface DomainCheck {
  id: 'ownership' | 'routing' | 'https' | 'activation'
  label: string
  status: CheckStatus
  detail: string
  hint?: string
}

const HTTPS_TIMEOUT_MS = 8000

function stripTrailingDot(host: string): string {
  return host.replace(/\.$/, '').toLowerCase()
}

function dnsErrorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code
}

/** TXT record proving ownership — the same record the verify endpoint reads. */
async function checkOwnership(domain: string, token: string | null, isVerified: boolean): Promise<DomainCheck> {
  const host = `${VERIFICATION_HOST_PREFIX}.${domain}`
  const label = 'Ownership record (TXT)'

  // Verification is a one-time gate: once it passed, the record may be removed
  // without breaking anything, so do not report its absence as a problem.
  if (isVerified) {
    return { id: 'ownership', label, status: 'ok', detail: 'Ownership confirmed. The TXT record is no longer required.' }
  }

  if (!token) {
    return { id: 'ownership', label, status: 'fail', detail: 'This domain has no verification token. Remove it and add it again.' }
  }

  try {
    const records = (await dns.resolveTxt(host)).map(r => r.join('').trim())
    if (records.some(r => r === token)) {
      return { id: 'ownership', label, status: 'ok', detail: `${host} contains the correct token.` }
    }
    return {
      id: 'ownership',
      label,
      status: 'fail',
      detail: `${host} exists but holds a different value: ${records.join(', ').slice(0, 120)}`,
      hint: 'Replace the value with the token shown above. Some DNS panels wrap values in quotes — that is fine.',
    }
  } catch (err) {
    const code = dnsErrorCode(err)
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return {
        id: 'ownership',
        label,
        status: 'fail',
        detail: `No TXT record found at ${host}.`,
        hint: 'Add the TXT record shown above. New records can take a few minutes to appear.',
      }
    }
    return { id: 'ownership', label, status: 'warn', detail: `DNS lookup failed (${code || 'unknown error'}). Try again in a moment.` }
  }
}

/**
 * CNAME pointing at our Koyeb target. A Cloudflare orange-cloud proxy hides the
 * CNAME and answers with Cloudflare A records instead — indistinguishable from
 * apex CNAME flattening at the DNS level, so both land on the same warning and
 * the HTTPS check decides whether it actually works.
 */
async function checkRouting(domain: string): Promise<DomainCheck> {
  const label = 'Routing record (CNAME)'

  try {
    const cnames = (await dns.resolveCname(domain)).map(stripTrailingDot)
    if (cnames.some(c => c === CUSTOM_DOMAIN_TARGET.toLowerCase())) {
      return { id: 'routing', label, status: 'ok', detail: `${domain} points to ${CUSTOM_DOMAIN_TARGET}.` }
    }
    return {
      id: 'routing',
      label,
      status: 'fail',
      detail: `${domain} points to ${cnames.join(', ')} instead of ${CUSTOM_DOMAIN_TARGET}.`,
      hint: 'Change the CNAME target to the value shown above.',
    }
  } catch (err) {
    const code = dnsErrorCode(err)
    if (code !== 'ENOTFOUND' && code !== 'ENODATA') {
      return { id: 'routing', label, status: 'warn', detail: `DNS lookup failed (${code || 'unknown error'}). Try again in a moment.` }
    }
  }

  // No CNAME. Either nothing is configured, or a proxy / apex flattening is
  // answering with address records.
  const addresses: string[] = []
  await Promise.all([
    dns.resolve4(domain).then(a => addresses.push(...a)).catch(() => {}),
    dns.resolve6(domain).then(a => addresses.push(...a)).catch(() => {}),
  ])

  if (addresses.length === 0) {
    return {
      id: 'routing',
      label,
      status: 'fail',
      detail: `${domain} does not resolve at all — no CNAME and no A/AAAA record.`,
      hint: 'Add the CNAME record shown above.',
    }
  }

  return {
    id: 'routing',
    label,
    status: 'warn',
    detail: `${domain} resolves to ${addresses.slice(0, 3).join(', ')} but publishes no CNAME.`,
    hint: 'Normal for a root domain with CNAME flattening. On Cloudflare it also means the proxy (orange cloud) is on — switch the record to "DNS only", otherwise no certificate can be issued.',
  }
}

/** Does the domain actually serve this app over HTTPS? */
async function checkHttps(domain: string): Promise<DomainCheck> {
  const label = 'HTTPS / certificate'

  let response: Response
  try {
    response = await fetch(`https://${domain}/api/health`, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
      headers: { 'user-agent': 'eduskript-domain-check' },
    })
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code || dnsErrorCode(err)
    const certError = typeof code === 'string' && (code.includes('CERT') || code.includes('TLS') || code.includes('SSL'))
    return {
      id: 'https',
      label,
      status: 'fail',
      detail: certError
        ? `TLS handshake failed (${code}).`
        : `Could not reach https://${domain} (${code || 'timeout'}).`,
      hint: certError
        ? 'No valid certificate for this domain yet. On Cloudflare, turn the proxy off (DNS only) so the certificate can be issued; otherwise wait until we finish activation.'
        : 'Check the CNAME record. If DNS was changed recently, give it a few minutes.',
    }
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || 'elsewhere'
    return {
      id: 'https',
      label,
      status: 'warn',
      detail: `https://${domain} redirects to ${location}.`,
      hint: 'A redirect rule at your DNS or hosting provider is intercepting the domain. Remove it so requests reach us directly.',
    }
  }

  if (!response.ok) {
    // 403/404 straight from the edge is what an un-attached domain looks like:
    // TLS terminates, but no route exists for that hostname yet.
    const unattached = response.status === 403 || response.status === 404
    return {
      id: 'https',
      label,
      status: 'warn',
      detail: `https://${domain} answered with HTTP ${response.status}.`,
      hint: unattached
        ? 'Typical for a domain whose activation on our side is not finished yet. If the DNS records above are correct and this persists for more than a day, mail kontakt@luzmedia.ch.'
        : undefined,
    }
  }

  const body = await response.json().catch(() => null)
  if ((body as { status?: string } | null)?.status !== 'healthy') {
    return {
      id: 'https',
      label,
      status: 'warn',
      detail: `https://${domain} responds, but not with Eduskript.`,
      hint: 'Another service is still answering for this domain.',
    }
  }

  return { id: 'https', label, status: 'ok', detail: `https://${domain} is reachable and served by Eduskript.` }
}

/** DB-side state: an unverified domain is never routed, even with perfect DNS. */
function checkActivation(isVerified: boolean, siteLabel: string | null): DomainCheck {
  const label = 'Activation'
  if (!isVerified) {
    return {
      id: 'activation',
      label,
      status: 'fail',
      detail: 'Not verified yet — we do not serve this domain until verification succeeds.',
      hint: 'Once the TXT record is in place, click "Verify".',
    }
  }
  return {
    id: 'activation',
    label,
    status: 'ok',
    detail: siteLabel ? `Verified and mapped to "${siteLabel}".` : 'Verified.',
  }
}

export async function diagnoseDomain({
  domain,
  verificationToken,
  isVerified,
  siteLabel = null,
}: {
  domain: string
  verificationToken: string | null
  isVerified: boolean
  siteLabel?: string | null
}): Promise<{ checks: DomainCheck[]; target: string }> {
  const [ownership, routing, https] = await Promise.all([
    checkOwnership(domain, verificationToken, isVerified),
    checkRouting(domain),
    checkHttps(domain),
  ])

  // DNS alone cannot tell apex flattening from a Cloudflare proxy, so
  // checkRouting warns for both. If the domain demonstrably serves the app,
  // that ambiguity does not matter — report it as fine.
  if (routing.status === 'warn' && https.status === 'ok') {
    routing.status = 'ok'
    routing.detail = `${domain} reaches Eduskript. No CNAME is visible (root-domain flattening or a proxy), but routing works.`
    routing.hint = undefined
  }

  return {
    checks: [ownership, routing, checkActivation(isVerified, siteLabel), https],
    target: CUSTOM_DOMAIN_TARGET,
  }
}
