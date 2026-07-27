/**
 * Liveness probe.
 *
 * Deliberately does NOT touch the database. The platform probes this endpoint
 * every few seconds; a `SELECT 1` per probe measured ~1 query per probe and,
 * worse, kept the managed Postgres instance permanently active so it could
 * never autosuspend — and it bills compute-hours, not queries. A liveness
 * probe should answer "is this process serving HTTP", which is the thing a
 * container restart can fix; a DB outage is not.
 *
 * GET /api/health?db=1 still runs the round trip, for manual checks and for a
 * readiness probe if one is ever wired up.
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('db') !== '1') {
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    })
  }

  try {
    // Imported lazily so the common path pulls in no Prisma client at all.
    const { checkDatabaseConnection } = await import('@/lib/db-connection')
    const isHealthy = await checkDatabaseConnection()

    if (!isHealthy) {
      return NextResponse.json(
        { status: 'unhealthy', database: 'disconnected' },
        { status: 503 }
      )
    }

    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    })
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Health check failed' },
      { status: 500 }
    )
  }
}
