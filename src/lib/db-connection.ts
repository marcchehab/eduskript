/**
 * Database Connection Utilities
 *
 * Provides helper functions for database operations and health checks.
 * Prisma manages connection pooling automatically via src/lib/prisma.ts.
 */

import { prisma } from './prisma'

/**
 * Wraps a database operation with consistent error logging.
 * Use this for operations where you want centralized error tracking.
 *
 * Note: Prisma handles connection pooling automatically - this wrapper
 * only adds error logging, not connection management.
 */
export async function withDatabaseConnection<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    console.error('Database operation failed:', error)
    throw error
  }
}

/**
 * Health check function for monitoring/readiness probes.
 * Returns true if the database is reachable.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
}
