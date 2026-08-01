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
 * The list is the union of two sources, and the distinction matters:
 *
 *   - recorded request counts (recordPathHit) decide the ORDER, because they
 *     are the only real popularity signal we have;
 *   - each host's sitemap decides the COVERAGE, because a URL nobody has
 *     requested yet is precisely the one that will cost a cold render when a
 *     crawler reaches it.
 *
 * Warming only the top 50 was measured to be far too little: crawlers walk the
 * long tail and rarely repeat a URL, so 393 distinct paths were requested in
 * one afternoon and the database stayed awake 95% of it. The tail is only a few
 * hundred URLs, so covering all of it is affordable and turns crawler traffic
 * into cache hits that never touch the database.
 */

// High enough to cover the whole public surface (~500 URLs across all hosts),
// not a popularity cut-off any more. Lower it with WARM_TOP_N if a boot burst
// ever gets too long.
const DEFAULT_TOP_N = 1000
const LOOKBACK_DAYS = 7
const CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 15_000

/** Busiest `host/path` strings over the lookback window, most-hit first. */
async function getTopPaths(limit: number): Promise<string[]> {
  const { prismaBase } = await import('@/lib/prisma')
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000)

  const rows = await prismaBase.$queryRaw<Array<{ name: string }>>`
    SELECT name
      FROM metric_points
     WHERE name LIKE ${PATH_METRIC_PREFIX + '%'}
       AND timestamp >= ${since}
     GROUP BY name
     ORDER BY SUM(count) DESC
     LIMIT ${limit}
  `

  return rows.map(r => r.name.slice(PATH_METRIC_PREFIX.length)).filter(Boolean)
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

  // Requested paths first, in popularity order, so the URLs people actually
  // use are cached earliest even if the burst is cut short.
  let requested: string[] = []
  try {
    requested = await getTopPaths(limit)
  } catch (error) {
    console.error('[Warmer] Could not read the path history:', error)
  }

  // Then everything else the sitemaps advertise. This is the part that stops a
  // crawler from finding cold URLs all day; the hit counts alone only ever
  // cover what has already been paid for once.
  let advertised: string[] = []
  try {
    const hosts = await getKnownHosts()
    const perHost = await Promise.all(hosts.map(host => getSitemapPaths(host, port)))
    advertised = perHost.flat()
  } catch (error) {
    console.error('[Warmer] Could not read the sitemaps:', error)
  }

  const paths = [...new Set([...requested, ...advertised])].slice(0, limit)

  if (paths.length === 0) {
    console.log('[Warmer] Nothing to warm (no path history and no sitemap URLs)')
    return
  }

  let warmed = 0
  const failures: string[] = []
  const queue = [...paths]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const result = await warmPath(next, port)
      if (result.ok) warmed++
      else failures.push(`${next} (${result.status})`)
    }
  })
  await Promise.all(workers)

  console.log(
    `[Warmer] Warmed ${warmed}/${paths.length} paths ` +
      `(${requested.length} requested, ${paths.length - requested.length} from sitemaps) ` +
      `in ${Math.round((Date.now() - started) / 1000)}s`
  )
  // Name the failures: "warmed 1/4" on its own gave no way to tell a 404 from a
  // dropped Host header.
  if (failures.length > 0) {
    console.log(`[Warmer] Not warmed: ${failures.slice(0, 10).join(', ')}`)
  }
}
