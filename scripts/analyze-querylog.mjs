#!/usr/bin/env node
/**
 * Analyze .querylog.jsonl produced by QUERY_LOG=1 pnpm dev.
 *
 * Usage:
 *   node scripts/analyze-querylog.mjs                 # whole log
 *   node scripts/analyze-querylog.mjs --since 60      # last 60 seconds
 *   node scripts/analyze-querylog.mjs --bursts        # group into request-sized clusters
 *   node scripts/analyze-querylog.mjs --gap 400       # cluster gap in ms (default 250)
 *
 * Clusters are a heuristic: consecutive queries less than --gap apart are
 * treated as one request. That is usually right for a manually driven browser
 * session on an otherwise idle dev server, and wrong under concurrent load.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// QUERY_LOG_FILE mirrors the server-side override (next start runs from
// .next/standalone, so the default location differs between dev and prod).
const LOG = process.env.QUERY_LOG_FILE || join(process.cwd(), '.querylog.jsonl')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(args[i + 1])
}
const has = name => args.includes(`--${name}`)

if (!existsSync(LOG)) {
  console.error(`No ${LOG}. Run: QUERY_LOG=1 pnpm dev`)
  process.exit(1)
}

const entries = readFileSync(LOG, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)

const sinceSec = flag('since', null)
const cutoff = sinceSec ? Date.now() - sinceSec * 1000 : 0
const rows = entries.filter(e => e.t >= cutoff)

if (rows.length === 0) {
  console.log('No entries in range.')
  process.exit(0)
}

const spanMs = rows[rows.length - 1].t - rows[0].t
const spanMin = spanMs / 60000

console.log(`\n${rows.length} queries over ${(spanMs / 1000).toFixed(1)}s` +
  (spanMin > 0.5 ? ` (${(rows.length / spanMin).toFixed(1)}/min)` : ''))
console.log(`Window: ${new Date(rows[0].t).toLocaleTimeString()} → ${new Date(rows[rows.length - 1].t).toLocaleTimeString()}\n`)

/**
 * Who issued the query: nearest named frame, plus the outermost one for
 * context (usually the route component or handler), e.g.
 * "getPublicLayers ← PublicPage".
 */
function attribution(entry) {
  const frames = (entry.at ?? []).filter(f => f !== 'cachedCb')
  if (frames.length === 0) return '(no stack)'
  const nearest = frames[0]
  const outer = frames[frames.length - 1]
  return nearest === outer ? nearest : `${nearest} ← ${outer}`
}

function table(title, map, extra = () => '') {
  const sorted = [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  const width = Math.max(...sorted.map(([k]) => k.length), title.length)
  console.log(`${title.padEnd(width)}  count      ms  ${extra.header ?? ''}`)
  console.log('-'.repeat(width + 20))
  for (const [key, v] of sorted.slice(0, 25)) {
    console.log(`${key.padEnd(width)}  ${String(v.count).padStart(5)}  ${v.ms.toFixed(0).padStart(6)}  ${extra(v)}`)
  }
  if (sorted.length > 25) console.log(`… and ${sorted.length - 25} more`)
  console.log()
}

const byQuery = new Map()
const bySite = new Map()
for (const e of rows) {
  for (const [map, key] of [[byQuery, e.q], [bySite, attribution(e)]]) {
    const v = map.get(key) ?? { count: 0, ms: 0 }
    v.count++
    v.ms += e.ms
    map.set(key, v)
  }
}

table('QUERY', byQuery)
table('CALL SITE', bySite)

if (has('bursts')) {
  const gap = flag('gap', 250)
  const clusters = []
  let current = null
  for (const e of rows) {
    if (!current || e.t - current.end > gap) {
      current = { start: e.t, end: e.t, entries: [e] }
      clusters.push(current)
    } else {
      current.end = e.t
      current.entries.push(e)
    }
  }

  console.log(`BURSTS (gap > ${gap}ms starts a new one) — ${clusters.length} total\n`)
  for (const c of clusters.slice(-30)) {
    const counts = new Map()
    for (const e of c.entries) counts.set(e.q, (counts.get(e.q) ?? 0) + 1)
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([q, n]) => (n > 1 ? `${q}×${n}` : q))
      .join(', ')
    console.log(
      `${new Date(c.start).toLocaleTimeString()}  ${String(c.entries.length).padStart(3)} queries  ` +
      `${String(c.end - c.start).padStart(5)}ms  ${top}`
    )
  }
  console.log()

  const sizes = clusters.map(c => c.entries.length).sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)]
  console.log(`Burst size: median ${median}, max ${sizes[sizes.length - 1]}\n`)
}
