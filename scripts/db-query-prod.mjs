#!/usr/bin/env node
/**
 * READ-ONLY prod query helper. Uses DATABASE_URL_PROD from .env with SSL
 * (Koyeb requires it). Mirrors scripts/db-query.mjs but for prod.
 * Usage: node scripts/db-query-prod.mjs "SELECT ..."
 * Only run SELECTs here — this points at the production database.
 */
import pg from 'pg'
import { config } from 'dotenv'

config()

const connectionString = process.env.DATABASE_URL_PROD
const query = process.argv[2]

if (!connectionString) {
  console.error('DATABASE_URL_PROD not set in .env')
  process.exit(1)
}
if (!query) {
  console.error('Usage: node scripts/db-query-prod.mjs "SELECT ..."')
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  const result = await client.query(query)
  if (result.rows.length === 0) console.log('No rows returned')
  else console.table(result.rows)
} catch (err) {
  console.error('Query failed:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
