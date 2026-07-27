/**
 * Local query profiler.
 *
 * Off unless QUERY_LOG=1. When on, every query through the extended Prisma
 * client appends one JSONL line to .querylog.jsonl with its call site, so
 * `node scripts/analyze-querylog.mjs` can say *which code* issued the queries
 * rather than just how many there were.
 *
 * NEVER set QUERY_LOG in a deployed environment: it captures a stack trace and
 * does a synchronous append per query, and the file grows without bound. The
 * flag deliberately still works under NODE_ENV=production, because caching
 * behaviour (ISR, the full route cache) only exists in a production build, and
 * that is exactly what needs profiling.
 */

import { appendFileSync } from 'fs'
import { join } from 'path'

/**
 * Defaults to .querylog.jsonl in the working directory. `next start` runs from
 * .next/standalone, so set QUERY_LOG_FILE to an absolute path when profiling a
 * production build if you want the log next to the analyzer.
 */
export const QUERY_LOG_PATH =
  process.env.QUERY_LOG_FILE || join(process.cwd(), '.querylog.jsonl')

export const queryLogEnabled = process.env.QUERY_LOG === '1'

if (queryLogEnabled) {
  console.warn(`[query-log] ENABLED — appending every query to ${QUERY_LOG_PATH}. Never leave this on in a deployment.`)
}

export interface QueryLogEntry {
  /** Epoch ms when the query finished. */
  t: number
  /** e.g. "user.findUnique" or "$queryRaw". */
  q: string
  /** Duration in ms, rounded to 0.1. */
  ms: number
  /** App-code stack frames, nearest first. */
  at: string[]
}

/**
 * Named frames from the current stack, nearest first.
 *
 * Turbopack collapses the whole server into a handful of chunk files, so file
 * paths in dev stacks are useless (`chunks/ssr/[root-of-the-server]__x._.js`).
 * Function names survive, though — `getPublicLayers`, `PublicPage`,
 * `generateMetadata` — and those are what identify the caller. Anonymous
 * frames and this module's own frames are dropped.
 */
const OWN_FRAMES = new Set(['callSite', 'logQuery'])

function callSite(limit = 6): string[] {
  const stack = new Error().stack
  if (!stack) return []

  // QUERY_LOG_RAW=1 keeps the unparsed frames, for working out what the
  // bundler actually produces.
  if (process.env.QUERY_LOG_RAW === '1') {
    return stack.split('\n').slice(1, 25).map(l => l.trim())
  }

  const frames: string[] = []
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('node_modules') || line.includes('node:internal')) continue

    // "    at async Foo (/path/chunk.js:12:3)" → "Foo"
    const m = line.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(/)
    if (!m) continue
    const fn = m[1]
    if (OWN_FRAMES.has(fn) || fn.startsWith('Object.') || fn === '<anonymous>') continue

    if (frames[frames.length - 1] !== fn) frames.push(fn)
    if (frames.length >= limit) break
  }
  return frames
}

/**
 * Append one entry. Synchronous on purpose: an async stream would reorder
 * entries relative to the dev server's own request log, which is what the
 * analyzer correlates against. Only ever runs in dev with the flag on.
 */
export function logQuery(name: string, durationMs: number): void {
  if (!queryLogEnabled) return

  const entry: QueryLogEntry = {
    t: Date.now(),
    q: name,
    ms: Math.round(durationMs * 10) / 10,
    at: callSite(),
  }

  try {
    appendFileSync(QUERY_LOG_PATH, JSON.stringify(entry) + '\n')
  } catch {
    // Logging must never break a request.
  }
}
