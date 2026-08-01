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
 * The list comes from real request counts recorded by the proxy (see
 * recordPathHit), not from the sitemap: the sitemap has no popularity signal
 * and lists every URL, most of which nobody asks for.
 */

const DEFAULT_TOP_N = 50
const LOOKBACK_DAYS = 7
const CONCURRENCY = 3
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

  let paths: string[]
  try {
    paths = await getTopPaths(limit)
  } catch (error) {
    console.error('[Warmer] Could not read the path history:', error)
    return
  }

  if (paths.length === 0) {
    console.log('[Warmer] No path history yet, nothing to warm')
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
    `[Warmer] Warmed ${warmed}/${paths.length} paths in ${Math.round((Date.now() - started) / 1000)}s`
  )
  // Name the failures: "warmed 1/4" on its own gave no way to tell a 404 from a
  // dropped Host header.
  if (failures.length > 0) {
    console.log(`[Warmer] Not warmed: ${failures.slice(0, 10).join(', ')}`)
  }
}
