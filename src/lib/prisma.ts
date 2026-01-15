import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { recordDbQuery } from '@/lib/metrics/request-context'
import { recordMetric } from '@/lib/metrics/buffer'

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

// Add metrics tracking extension for general use
export const prisma = basePrisma.$extends({
  query: {
    $allOperations({ operation, model, args, query }) {
      const start = performance.now()
      return query(args).finally(() => {
        const duration = performance.now() - start
        // Record to request context (for per-request aggregation)
        recordDbQuery(duration)
        // Record directly to buffer (always visible in metrics)
        recordMetric('db_query_time_ms', duration)
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
