import 'server-only'
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
 * Request every path once against the local server so Next fills its ISR cache.
 *
 * Sends the recorded host as the Host header, because the proxy routes by it —
 * without that every tenant's URL would resolve to the default org and warm the
 * wrong page.
 */
async function warmPath(hostAndPath: string, port: string): Promise<boolean> {
  const slash = hostAndPath.indexOf('/')
  if (slash <= 0) return false
  const host = hostAndPath.slice(0, slash)
  const path = hostAndPath.slice(slash)

  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      headers: { host, 'user-agent': 'eduskript-cache-warmer' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return res.ok || (res.status >= 300 && res.status < 400)
  } catch {
    return false
  }
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
  const queue = [...paths]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (await warmPath(next, port)) warmed++
    }
  })
  await Promise.all(workers)

  console.log(
    `[Warmer] Warmed ${warmed}/${paths.length} paths in ${Math.round((Date.now() - started) / 1000)}s`
  )
}
