/**
 * SQL Executor - Client-side SQL query execution using sql.js
 *
 * This module provides functionality to execute SQL queries against SQLite databases
 * loaded in the browser using sql.js WASM.
 */

import initSqlJs, { Database, SqlJsStatic } from 'sql.js'

// SQL.js singleton instance
let sqlInstance: SqlJsStatic | null = null
let currentDatabase: Database | null = null
let currentDatabasePath: string | null = null

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

// Available databases
export const AVAILABLE_DATABASES = [
  { name: 'Netflix', path: '/sql/netflixdb.sqlite', description: 'Movie and TV show data' },
  { name: 'Chinook', path: '/sql/chinook.db', description: 'Digital media store data' },
  { name: 'Employees & Buildings', path: '/sql/buildings_employees.db', description: 'Workplace data' },
  { name: 'Sales', path: '/sql/sales.db', description: 'Sales and customers data' },
  { name: 'World Bank Indicators', path: '/sql/world_bank_indicators.db', description: 'Economic indicators' },
] as const

/**
 * Initialize SQL.js WASM module
 */
async function initializeSqlJs(): Promise<SqlJsStatic> {
  if (!sqlInstance) {
    sqlInstance = await initSqlJs({
      locateFile: (file) => `/sql/wasm/${file}`,
    })
  }
  return sqlInstance
}

/**
 * Load a database from the given path
 */
export async function loadDatabase(dbPath: string): Promise<void> {
  // If the same database is already loaded, do nothing
  if (currentDatabase && currentDatabasePath === dbPath) {
    return
  }

  // Close existing database if any
  if (currentDatabase) {
    currentDatabase.close()
    currentDatabase = null
    currentDatabasePath = null
  }

  // Initialize SQL.js if needed
  const sql = await initializeSqlJs()

  // Fetch database file
  const response = await fetch(dbPath)
  if (!response.ok) {
    throw new Error(`Failed to load database: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const uInt8Array = new Uint8Array(arrayBuffer)

  // Create database from file
  currentDatabase = new sql.Database(uInt8Array)
  currentDatabasePath = dbPath

  // Verify database with a test query
  const versionQuery = currentDatabase.exec('SELECT sqlite_version();')
  console.log('Database loaded. SQLite version:', versionQuery[0]?.values[0][0] || 'Unknown')
}

/**
 * Execute a SQL query against the currently loaded database
 */
export async function executeSqlQuery(query: string): Promise<SqlExecutionResult> {
  const startTime = performance.now()

  try {
    if (!currentDatabase) {
      throw new Error('No database loaded. Please select a database first.')
    }

    // Apply default limit to prevent overwhelming results
    const queryWithLimit = applyDefaultLimit(query)

    // Execute the query
    const results = currentDatabase.exec(queryWithLimit)

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
 * Get information about the current database (tables and their schemas)
 */
export async function getDatabaseSchema(): Promise<SqlExecutionResult> {
  if (!currentDatabase) {
    return {
      success: false,
      error: 'No database loaded',
    }
  }

  try {
    // Get all tables
    const tables = currentDatabase.exec(`
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
 * Get the current database path
 */
export function getCurrentDatabasePath(): string | null {
  return currentDatabasePath
}

/**
 * Close the current database connection
 */
export function closeDatabase(): void {
  if (currentDatabase) {
    currentDatabase.close()
    currentDatabase = null
    currentDatabasePath = null
  }
}
