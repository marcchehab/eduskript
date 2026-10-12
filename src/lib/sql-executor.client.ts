/**
 * SQL Executor - Client-side ONLY SQL query execution using sql.js
 *
 * This file should NEVER be imported on the server side.
 * All imports from this file should be dynamic imports wrapped in client-only code.
 *
 * sql.js is bundled from npm (dynamic import -> lazy chunk). The bundler picks
 * the package's `browser` export (dist/sql-wasm-browser.js), which has no
 * Node `fs`/`path` branch -- that branch is what broke Turbopack when the main
 * entry was imported. The .wasm is emitted as a static asset via
 * `new URL(..., import.meta.url)`, so everything is served from our origin.
 */

'use client'

// Type definitions (inline to avoid any imports)
interface SqlJsDatabase {
  run(sql: string): void
  exec(sql: string): Array<{ columns: string[]; values: any[][] }>
  close(): void
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase
}

type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>

// SQL.js singleton instance
let sqlInstance: SqlJsStatic | null = null

// Database instances stored by path (allows multiple databases to be open simultaneously)
const databaseCache = new Map<string, SqlJsDatabase>()

// In-flight load deduplication: prevents N SQL editors on the same page from
// triggering N parallel fetches of the same database file from S3.
const pendingLoads = new Map<string, Promise<SqlJsDatabase>>()

export interface SqlResultSet {
  columns: string[]
  values: any[][]
}

export interface SqlExecutionResult {
  success: boolean
  results?: SqlResultSet[]
  error?: string
  executionTime?: number
}

// Note: Databases are now stored per-skript in the file storage system.
// The database path can be:
// 1. A file API path: /api/files/[fileId]
// 2. A database name that will be resolved to a file in the current skript

/**
 * Initialize SQL.js WASM module
 */
async function initializeSqlJs(): Promise<SqlJsStatic> {
  if (!sqlInstance) {
    const mod = (await import('sql.js')) as unknown as { default: InitSqlJs }
    const wasmUrl = new URL('sql.js/dist/sql-wasm-browser.wasm', import.meta.url).href
    sqlInstance = await mod.default({ locateFile: () => wasmUrl })
  }
  return sqlInstance
}

/**
 * Load a database from the given path.
 * Returns the database instance (cached if already loaded).
 * Deduplicates concurrent requests: if N editors request the same DB before
 * the first fetch completes, they all share a single fetch+parse.
 */
export async function loadDatabase(dbPath: string): Promise<SqlJsDatabase> {
  // Check cache first
  const cached = databaseCache.get(dbPath)
  if (cached) return cached

  // Deduplicate in-flight loads
  const pending = pendingLoads.get(dbPath)
  if (pending) return pending

  const promise = loadDatabaseImpl(dbPath)
  pendingLoads.set(dbPath, promise)
  try {
    return await promise
  } finally {
    pendingLoads.delete(dbPath)
  }
}

async function loadDatabaseImpl(dbPath: string): Promise<SqlJsDatabase> {
  const sql = await initializeSqlJs()

  const response = await fetch(dbPath)
  if (!response.ok) {
    throw new Error(`Failed to load database: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const uInt8Array = new Uint8Array(arrayBuffer)

  const database = new sql.Database(uInt8Array)
  databaseCache.set(dbPath, database)

  return database
}

/**
 * Execute a SQL query against a specific database.
 * Set applyLimit=false to skip the automatic LIMIT 100 (needed for verification).
 */
export async function executeSqlQuery(query: string, dbPath: string, { applyLimit = true }: { applyLimit?: boolean } = {}): Promise<SqlExecutionResult> {
  const startTime = performance.now()

  try {
    // Get or load the database
    const database = databaseCache.get(dbPath)
    if (!database) {
      throw new Error('No database loaded. Please select a database first.')
    }

    // Apply default limit to prevent overwhelming results (skip for verification)
    const queryWithLimit = applyLimit ? applyDefaultLimit(query) : query

    // Execute the query
    const results = database.exec(queryWithLimit)

    const executionTime = performance.now() - startTime

    return {
      success: true,
      results,
      executionTime,
    }
  } catch (error: any) {
    const executionTime = performance.now() - startTime

    return {
      success: false,
      error: error.message || 'Unknown error occurred',
      executionTime,
    }
  }
}

/**
 * Apply a default LIMIT if one isn't already specified
 */
function applyDefaultLimit(sql: string): string {
  // Skip applying limit for non-SELECT queries
  if (!sql.trim().toLowerCase().startsWith('select')) {
    return sql
  }

  // Check if query already has a LIMIT clause
  const hasLimit = /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?(?:\s*;)?\s*$/i.test(sql)

  if (hasLimit) {
    return sql // Keep original query if it already has a LIMIT
  }

  // Add default LIMIT 100
  const trimmedSql = sql.trim()
  const endsWithSemicolon = trimmedSql.endsWith(';')

  if (endsWithSemicolon) {
    return trimmedSql.slice(0, -1) + ' LIMIT 100;'
  } else {
    return trimmedSql + ' LIMIT 100'
  }
}

/**
 * Get information about a specific database (tables and their schemas)
 */
export async function getDatabaseSchema(dbPath: string): Promise<SqlExecutionResult> {
  const database = databaseCache.get(dbPath)
  if (!database) {
    return {
      success: false,
      error: 'No database loaded',
    }
  }

  try {
    // Get all tables
    const tables = database.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `)

    return {
      success: true,
      results: tables,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get database schema',
    }
  }
}

/**
 * Check if a database is already cached (loaded)
 */
export function isDatabaseCached(dbPath: string): boolean {
  return databaseCache.has(dbPath)
}

/**
 * Close a specific database connection
 */
export function closeDatabase(dbPath: string): void {
  const database = databaseCache.get(dbPath)
  if (database) {
    database.close()
    databaseCache.delete(dbPath)
  }
}

/**
 * Close all database connections
 */
export function closeAllDatabases(): void {
  databaseCache.forEach(db => db.close())
  databaseCache.clear()
}
