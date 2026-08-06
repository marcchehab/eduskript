/**
 * Awake-time report for the managed Postgres.
 *
 * The instance bills wall-clock time spent awake and suspends about five
 * minutes after the last activity, so the cost is driven by how queries are
 * SPREAD, not by how many there are: one query every five minutes costs a full
 * hour, a thousand queries in one burst cost five. db_queries_total cannot tell
 * those apart, which is why DbActivityHour stores the minutes themselves.
 *
 * This module turns those masks into awake minutes: each active minute is
 * expanded by SUSPEND_MINUTES and the union is counted, so overlapping windows
 * are not double-counted and a query at 10:59 correctly keeps 11:00–11:03 awake.
 *
 * Caveats worth knowing before trusting the number:
 *   - only queries through the extended Prisma client are recorded; the cron,
 *     psql and Prisma Studio keep the instance awake invisibly.
 *   - minute resolution means each event is placed within ±1 minute.
 *   - SUSPEND_MINUTES is Koyeb's undocumented Neon setting, observed at ~5 and
 *     not configurable, so treat the result as a close estimate, not a bill.
 */

import { prismaBase } from '@/lib/prisma'

/** Observed suspend delay: activity keeps the instance up for this long after. */
export const SUSPEND_MINUTES = 5

const HOUR_MS = 3600000
const MINUTE_MS = 60000

export interface AwakeWindow {
  from: Date
  to: Date
  /** Minutes the instance is estimated to have been awake. */
  awakeMinutes: number
  /** Minutes in the window. */
  totalMinutes: number
  /** awakeMinutes / totalMinutes, 0..1. */
  fraction: number
  /** Minutes that actually saw a query, before the suspend delay is applied. */
  activeMinutes: number
}

/** Per-hour awake minutes, for charting. Hours are UTC, oldest first. */
export interface AwakeHour {
  hour: Date
  awakeMinutes: number
  activeMinutes: number
}

/**
 * Expand the stored masks into a set of absolute minute indices that the
 * instance was awake for.
 *
 * Reads one extra hour before `from` so a query just before the window still
 * contributes its tail — the whole reason the masks are stored per minute.
 *
 * O(hours × 60) in time and O(awake minutes) in memory; over 24h that is 1440
 * iterations and at most 1440 set entries.
 */
async function awakeMinuteSet(from: Date, to: Date): Promise<{ awake: Set<number>; active: Set<number> }> {
  const lookbackFrom = new Date(from.getTime() - SUSPEND_MINUTES * MINUTE_MS)

  const rows = await prismaBase.dbActivityHour.findMany({
    where: { hour: { gte: new Date(Math.floor(lookbackFrom.getTime() / HOUR_MS) * HOUR_MS), lt: to } },
    orderBy: { hour: 'asc' },
  })

  const awake = new Set<number>()
  const active = new Set<number>()

  for (const row of rows) {
    const hourIndex = Math.floor(row.hour.getTime() / MINUTE_MS)
    const mask = row.minutes
    for (let m = 0; m < 60; m++) {
      if (!((mask >> BigInt(m)) & 1n)) continue
      const absolute = hourIndex + m
      active.add(absolute)
      for (let d = 0; d < SUSPEND_MINUTES; d++) awake.add(absolute + d)
    }
  }

  return { awake, active }
}

/** Awake time over an arbitrary window. */
export async function getAwakeWindow(from: Date, to: Date): Promise<AwakeWindow> {
  const { awake, active } = await awakeMinuteSet(from, to)

  const firstMinute = Math.floor(from.getTime() / MINUTE_MS)
  const lastMinute = Math.floor(to.getTime() / MINUTE_MS)
  const totalMinutes = Math.max(0, lastMinute - firstMinute)

  let awakeMinutes = 0
  let activeMinutes = 0
  for (let m = firstMinute; m < lastMinute; m++) {
    if (awake.has(m)) awakeMinutes++
    if (active.has(m)) activeMinutes++
  }

  return {
    from,
    to,
    awakeMinutes,
    totalMinutes,
    fraction: totalMinutes > 0 ? awakeMinutes / totalMinutes : 0,
    activeMinutes,
  }
}

/** Awake minutes per hour over a window, oldest first. */
export async function getAwakeHours(from: Date, to: Date): Promise<AwakeHour[]> {
  const { awake, active } = await awakeMinuteSet(from, to)

  const hours: AwakeHour[] = []
  const firstHour = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS
  for (let h = firstHour; h < to.getTime(); h += HOUR_MS) {
    const base = Math.floor(h / MINUTE_MS)
    let awakeMinutes = 0
    let activeMinutes = 0
    for (let m = 0; m < 60; m++) {
      if (awake.has(base + m)) awakeMinutes++
      if (active.has(base + m)) activeMinutes++
    }
    hours.push({ hour: new Date(h), awakeMinutes, activeMinutes })
  }
  return hours
}
