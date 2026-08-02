import 'server-only'
import http from 'node:http'
import { PATH_METRIC_PREFIX } from '@/lib/metrics/buffer'

/**
 * Re-render the busiest public URLs once, right after a deploy.
 *
 * ISR entries live in the instance's filesystem, so every deploy starts with an
 * empty cache and the first visitor to each URL pays a full render plus its
 * queries. Scattered across a day that is the expensive shape: the managed
 * Postgres sleeps 5 minutes after the last connection, so N cold URLs spread
 * over N hours means N separate wake windows. Warming does the same work in one
 * burst while the instance is already awake, after which the endpoint can sleep
 * through the crawler traffic that follows.
 *
 * Two sources with strictly separate jobs:
 *
 *   - each host's sitemap decides WHAT is warmed. It is the authoritative list
 *     of public URLs, and it excludes junk for free: about a fifth of the paths
 *     we record are vulnerability scans, which were taking warm slots from real
 *     pages. Deleting those rows would not have helped, since the scanners
 *     return within the hour.
 *   - recorded request counts (recordPathHit) decide the ORDER. With the cap
 *     currently above the sitemap size this changes nothing about *what* gets
 *     warmed, but it still decides what is warm first if the budget or the
 *     breaker cuts a run short, and it becomes load-bearing again as soon as
 *     the sitemap outgrows the cap.
 *
 * A URL absent from the sitemap is never warmed — unlisted pages and /p/{id}
 * links stay cold until something requests them.
 *
 * Warming only the top 50 was measured to be far too little: crawlers walk the
 * long tail and rarely repeat a URL, so 393 distinct paths were requested in
 * one afternoon and the database stayed awake 95% of it. The tail is only a few
 * hundred URLs, so covering all of it is affordable and turns crawler traffic
 * into cache hits that never touch the database.
 */

// Warming 1000 URLs at concurrency 4 took production down: renders are heavy
// (markdown, KaTeX, plugins) and the instance is small, so the burst starved
// real requests and every host started returning 504. The warm-up is a
// background nicety and must never compete with serving — hence one request at
// a time, a pause between them, a total time budget, and a breaker that gives
// up if the server starts failing.
//
// The cap covers the whole public surface (497 sitemap URLs as of 2026-08-02).
// Measured at ~0.57 s per URL including the pause, so a full pass is roughly
// five minutes and the budget leaves room for growth. Pacing is what makes this
// safe, not the size of the list — the failure was concurrency, not count.
const DEFAULT_TOP_N = 500
const LOOKBACK_DAYS = 7
const CONCURRENCY = 1
const DELAY_BETWEEN_MS = 400
const MAX_TOTAL_MS = 10 * 60_000
const MAX_CONSECUTIVE_FAILURES = 5
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Request counts per `host/path` over the lookback window.
 *
 * Used only to ORDER the sitemap URLs, never to choose them: roughly a fifth of
 * the recorded paths are vulnerability scans (/wp-admin, /wp-includes, random
 * probes) which would otherwise take warm slots from real pages. Deleting those
 * rows would not help — the scanners come back within the hour — but they never
 * appear in a sitemap, so intersecting is self-maintaining.
 */
async function getHitCounts(): Promise<Map<string, number>> {
  const { prismaBase } = await import('@/lib/prisma')
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000)

  const rows = await prismaBase.$queryRaw<Array<{ name: string; hits: bigint }>>`
    SELECT name, SUM(count) AS hits
      FROM metric_points
     WHERE name LIKE ${PATH_METRIC_PREFIX + '%'}
       AND timestamp >= ${since}
     GROUP BY name
  `

  const counts = new Map<string, number>()
  for (const row of rows) {
    const path = row.name.slice(PATH_METRIC_PREFIX.length)
    if (path) counts.set(path, Number(row.hits))
  }
  return counts
}

/** Every host we serve: verified custom domains plus the app's own hostnames. */
async function getKnownHosts(): Promise<string[]> {
  const { prismaBase } = await import('@/lib/prisma')

  const [teacherDomains, orgDomains] = await Promise.all([
    prismaBase.teacherCustomDomain.findMany({
      where: { isVerified: true },
      select: { domain: true },
    }),
    prismaBase.customDomain.findMany({
      where: { isVerified: true },
      select: { domain: true },
    }),
  ])

  // Keep in sync with APP_DOMAINS in src/proxy.ts — hardcoded there so a bad DB
  // row cannot take the site offline, so there is nothing to read it from.
  const appHosts = ['eduskript.org']

  return [...new Set([...appHosts, ...teacherDomains.map(d => d.domain), ...orgDomains.map(d => d.domain)])]
}

/**
 * Public URLs a host advertises, as `host/path` strings.
 *
 * Read over localhost with the Host header set, the same way warmPath works —
 * the sitemap route is per-tenant and resolves the host itself, so requesting
 * it any other way returns another tenant's URLs.
 */
async function getSitemapPaths(host: string, port: string): Promise<string[]> {
  const xml = await new Promise<string>(resolve => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/sitemap.xml',
        method: 'GET',
        headers: { host, 'user-agent': 'eduskript-cache-warmer' },
        timeout: REQUEST_TIMEOUT_MS,
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve('')
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve(body))
      }
    )
    req.on('timeout', () => { req.destroy(); resolve('') })
    req.on('error', () => resolve(''))
    req.end()
  })

  const paths: string[] = []
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const url = new URL(match[1])
      paths.push(`${url.host}${url.pathname}`)
    } catch {
      // A malformed <loc> is not worth failing the warm-up over.
    }
  }
  return paths
}

/**
 * Request one path against the local server so Next fills its ISR cache.
 *
 * Uses node:http rather than fetch because the proxy routes on the Host header
 * (src/proxy.ts) and undici silently drops a `host` header as forbidden — with
 * fetch every request arrived as localhost, resolved to the default org and
 * 404ed, so the first production run warmed 1 of 4 paths.
 *
 * Counts 2xx and 3xx as warmed: a redirect (exam pages, legacy URLs) is itself
 * the cached response we want.
 */
function warmPath(hostAndPath: string, port: string): Promise<{ ok: boolean; status: number | string }> {
  const slash = hostAndPath.indexOf('/')
  if (slash <= 0) return Promise.resolve({ ok: false, status: 'malformed' })
  const host = hostAndPath.slice(0, slash)
  const path = hostAndPath.slice(slash)

  return new Promise(resolve => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(port),
        path,
        method: 'GET',
        headers: { host, 'user-agent': 'eduskript-cache-warmer' },
        timeout: REQUEST_TIMEOUT_MS,
      },
      res => {
        const status = res.statusCode ?? 0
        res.resume() // drain, we only want the render to happen
        res.on('end', () => resolve({ ok: status >= 200 && status < 400, status }))
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 'timeout' })
    })
    req.on('error', err => resolve({ ok: false, status: err.message }))
    req.end()
  })
}

/**
 * Warm the top N paths. Never throws and never blocks startup — callers should
 * not await it. A cold history (first deploy, or a quiet week) simply warms
 * nothing.
 */
export async function warmTopPaths(): Promise<void> {
  const limit = Number(process.env.WARM_TOP_N ?? DEFAULT_TOP_N)
  if (!Number.isFinite(limit) || limit <= 0) return

  const port = process.env.PORT || '3000'
  const started = Date.now()

  // The sitemaps decide WHAT may be warmed — they are the authoritative list of
  // public URLs, and scanner probes never appear in one.
  let advertised: string[] = []
  try {
    const hosts = await getKnownHosts()
    const perHost = await Promise.all(hosts.map(host => getSitemapPaths(host, port)))
    advertised = [...new Set(perHost.flat())]
  } catch (error) {
    console.error('[Warmer] Could not read the sitemaps:', error)
  }

  if (advertised.length === 0) {
    console.log('[Warmer] No sitemap URLs, nothing to warm')
    return
  }

  // Recorded hits decide the ORDER, so the pages people actually open are
  // cached first if the run is cut short by the time budget or the breaker.
  let hits = new Map<string, number>()
  try {
    hits = await getHitCounts()
  } catch (error) {
    console.error('[Warmer] Could not read the path history, warming in sitemap order:', error)
  }

  const paths = advertised
    .sort((a, b) => (hits.get(b) ?? 0) - (hits.get(a) ?? 0))
    .slice(0, limit)
  const requestedCount = paths.filter(p => hits.has(p)).length

  let warmed = 0
  let consecutiveFailures = 0
  let stoppedEarly = ''
  const failures: string[] = []
  const queue = [...paths]

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (Date.now() - started > MAX_TOTAL_MS) {
        stoppedEarly = 'time budget'
        return
      }

      const result = await warmPath(next, port)
      if (result.ok) {
        warmed++
        consecutiveFailures = 0
      } else {
        failures.push(`${next} (${result.status})`)
        // A run of timeouts or connection errors means the server is
        // struggling — exactly the situation where warming must back off
        // rather than pile on.
        if (typeof result.status !== 'number') consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stoppedEarly = `${consecutiveFailures} consecutive failures`
          return
        }
      }

      // Breathe, so real requests get the instance back between renders.
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS))
    }
  })
  await Promise.all(workers)

  console.log(
    `[Warmer] Warmed ${warmed}/${paths.length} paths ` +
      `(${requestedCount} of them previously requested, ${advertised.length} advertised in total) ` +
      `in ${Math.round((Date.now() - started) / 1000)}s` +
      (stoppedEarly ? ` — stopped early: ${stoppedEarly}` : '')
  )
  // Name the failures: "warmed 1/4" on its own gave no way to tell a 404 from a
  // dropped Host header.
  if (failures.length > 0) {
    console.log(`[Warmer] Not warmed: ${failures.slice(0, 10).join(', ')}`)
  }
}
