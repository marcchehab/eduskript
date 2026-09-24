/**
 * Abuse and cost limits for the anonymous skript import. DB-backed (counts
 * ScriptImport rows), so they hold across Koyeb instances and restarts —
 * unlike the in-memory RateLimiter in src/lib/rate-limit.ts.
 *
 * Checked before a job starts. The cost check uses the cost of jobs already
 * finished today; jobs still running are not counted, so with N parallel jobs
 * the daily budget can be overshot by up to N × (max cost of one job ≈ $1–2
 * for a 30-page document with gemini-3.8-flash is ≈ $0.30; measured 2026-09-23:
 * $0.006 for a 1-page sheet, $0.10 for 6 pages with 117 legacy formulas).
 */
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Word's own count (docProps/app.xml) is often stale, so MAX_MARKDOWN_CHARS is the effective cap. */
export const MAX_WORD_PAGES = Number(process.env.SCRIPT_IMPORT_MAX_PAGES ?? 30)
/** ~30 pages of dense text; bounds the model cost of one job. */
export const MAX_MARKDOWN_CHARS = Number(process.env.SCRIPT_IMPORT_MAX_CHARS ?? 150_000)
export const PER_IP_PER_DAY = Number(process.env.SCRIPT_IMPORT_PER_IP_PER_DAY ?? 3)
export const GLOBAL_PER_DAY = Number(process.env.SCRIPT_IMPORT_PER_DAY ?? 100)
export const BUDGET_USD_PER_DAY = Number(process.env.SCRIPT_IMPORT_BUDGET_USD_PER_DAY ?? 25)
export const RETENTION_DAYS = 7

export function hashIp(ip: string): string {
  return createHash('sha256')
    .update(`${process.env.NEXTAUTH_SECRET ?? ''}:script-import:${ip}`)
    .digest('hex')
}

/** Returns an English error message if a new import is not allowed, else null. */
export async function checkLimits(ipHash: string): Promise<string | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [perIp, global, cost] = await Promise.all([
    prisma.scriptImport.count({ where: { ipHash, createdAt: { gte: since } } }),
    prisma.scriptImport.count({ where: { createdAt: { gte: since } } }),
    prisma.scriptImport.aggregate({ where: { createdAt: { gte: since } }, _sum: { costUsd: true } }),
  ])
  if (perIp >= PER_IP_PER_DAY) {
    return `You can import ${PER_IP_PER_DAY} documents per day. Please try again tomorrow, or create an account.`
  }
  if (global >= GLOBAL_PER_DAY || (cost._sum.costUsd ?? 0) >= BUDGET_USD_PER_DAY) {
    return 'Too many imports today. Please try again tomorrow.'
  }
  return null
}
