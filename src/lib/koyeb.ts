/**
 * Attaching custom domains to the Koyeb app.
 *
 * Passing our own TXT verification is not enough for a domain to be served:
 * the hostname must also exist on the Koyeb side, otherwise the edge has no
 * route for it and answers 403 (Cloudflare error 1000). Until 2026-07-31 that
 * was a manual `koyeb domains create` per domain; this module does it from the
 * verify endpoints instead.
 *
 * Requires KOYEB_API_TOKEN and KOYEB_APP_ID. With either unset every call is a
 * no-op returning `skipped` — local dev and self-hosted deployments keep
 * working, the domain just has to be attached by hand.
 *
 * API: https://www.koyeb.com/docs/reference/api
 *   POST /v1/domains              create (type CUSTOM, optional app_id)
 *   POST /v1/domains/{id}/refresh re-check DNS, flips PENDING → ACTIVE
 *
 * Quota is per organization and low on the Starter plan (5 domains as of
 * 2026-07-31; read it via GET /v1/organizations/{id}/quotas). A create over
 * quota fails with 400 — surfaced as `quota_exceeded` so callers can tell the
 * user rather than silently leaving the domain unrouted.
 */

const KOYEB_API = 'https://app.koyeb.com/v1'

export type KoyebAttachResult =
  | { status: 'attached'; domainId: string; koyebStatus: string }
  | { status: 'already_exists'; domainId: string; koyebStatus: string }
  | { status: 'skipped'; reason: string }
  | { status: 'quota_exceeded'; message: string }
  | { status: 'error'; message: string }

async function koyeb(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${KOYEB_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Existing Koyeb domain entry for `name`, or null. */
async function findDomain(name: string, token: string): Promise<{ id: string; status: string } | null> {
  const { ok, body } = await koyeb(`/domains?name=${encodeURIComponent(name)}&limit=100`, token)
  if (!ok) return null
  // The name filter is a substring match on Koyeb's side, so compare exactly.
  const hit = (body.domains || []).find((d: { name?: string }) => d.name === name)
  return hit ? { id: hit.id, status: hit.status } : null
}

/**
 * Make sure `name` is attached to our Koyeb app, then ask Koyeb to re-check
 * DNS so it goes ACTIVE without waiting for the next periodic check.
 *
 * Never throws: attaching is a best-effort side effect of verification, and a
 * Koyeb outage must not make a verified domain look unverified.
 */
export async function attachDomainToKoyeb(name: string): Promise<KoyebAttachResult> {
  const token = process.env.KOYEB_API_TOKEN
  const appId = process.env.KOYEB_APP_ID
  if (!token || !appId) return { status: 'skipped', reason: 'KOYEB_API_TOKEN or KOYEB_APP_ID not set' }

  try {
    const existing = await findDomain(name, token)
    if (existing) {
      await koyeb(`/domains/${existing.id}/refresh`, token, { method: 'POST', body: '{}' })
      return { status: 'already_exists', domainId: existing.id, koyebStatus: existing.status }
    }

    const created = await koyeb('/domains', token, {
      method: 'POST',
      body: JSON.stringify({ name, type: 'CUSTOM', app_id: appId }),
    })

    if (!created.ok) {
      const message = created.body?.message || `Koyeb API error ${created.status}`
      if (/quota/i.test(message)) return { status: 'quota_exceeded', message }
      return { status: 'error', message }
    }

    const domainId = created.body?.domain?.id
    if (!domainId) return { status: 'error', message: 'Koyeb returned no domain id' }

    // Koyeb verifies asynchronously; the refresh only nudges it. The domain
    // is typically ACTIVE within a minute, so callers should not block on it.
    const refreshed = await koyeb(`/domains/${domainId}/refresh`, token, { method: 'POST', body: '{}' })
    return {
      status: 'attached',
      domainId,
      koyebStatus: refreshed.body?.domain?.status || created.body?.domain?.status || 'PENDING',
    }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Koyeb request failed' }
  }
}

/** Remaining custom-domain slots, or null when unavailable. */
export async function getKoyebDomainQuota(): Promise<{ used: number; limit: number } | null> {
  const token = process.env.KOYEB_API_TOKEN
  const orgId = process.env.KOYEB_ORG_ID
  if (!token || !orgId) return null

  try {
    const [quotas, domains] = await Promise.all([
      koyeb(`/organizations/${orgId}/quotas`, token),
      koyeb('/domains?limit=100', token),
    ])
    if (!quotas.ok || !domains.ok) return null
    const limit = Number(quotas.body?.quotas?.custom_domains)
    const used = (domains.body?.domains || []).filter((d: { type?: string }) => d.type === 'CUSTOM').length
    return Number.isFinite(limit) ? { used, limit } : null
  } catch {
    return null
  }
}
