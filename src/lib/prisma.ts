import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { recordMetric } from '@/lib/metrics/buffer'
import { logQuery, queryLogEnabled } from '@/lib/query-log'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

// Create connection pool if not exists
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set!')
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('DATA')))
  throw new Error('DATABASE_URL environment variable is required')
}

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = globalForPrisma.pool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, // 10 seconds for Neon cold starts
  // pg defaults to max 10. A burst (e.g. bulk AI scoring) saturated 10 and made
  // every other request fail to acquire a connection → cascading "timeout
  // exceeded when trying to connect". 20 gives headroom while staying well under
  // the managed-Postgres connection cap.
  max: 20,
})
if (process.env.NODE_ENV !== 'production') globalForPrisma.pool = pool

// Create Prisma adapter
const adapter = new PrismaPg(pool)

const basePrisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: ['error', 'warn'], // Removed 'query' to reduce console noise
})

// Export base client for NextAuth adapter (requires $on method)
export const prismaBase = basePrisma

// Add metrics tracking extension for general use.
// Caveat: db_queries_total/db_query_time_ms only see queries made through this
// extended client. Queries issued via `prismaBase` — the NextAuth adapter and
// the metrics flush itself (src/lib/metrics/buffer.ts) — are NOT counted.
export const prisma = basePrisma.$extends({
  query: {
    $allOperations({ operation, model, args, query }) {
      const start = performance.now()
      return query(args).finally(() => {
        const duration = performance.now() - start
        recordMetric('db_query_time_ms', duration)
        recordMetric('db_queries_total', 1)
        // No-op unless QUERY_LOG=1 (see src/lib/query-log.ts — never set it in
        // a deployment).
        if (queryLogEnabled) {
          logQuery(model ? `${model}.${operation}` : operation, duration)
        }
      })
    },
  },
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

process.on('SIGINT', async () => {
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
