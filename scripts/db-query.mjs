#!/usr/bin/env node
/**
 * Simple database query utility using pg
 * Usage: node scripts/db-query.mjs "SELECT * FROM users LIMIT 5"
 */

import pg from 'pg'
import { config } from 'dotenv'

config() // Load .env file

// Parse `timestamp without time zone` as UTC, which is what the app writes.
// node-postgres otherwise interprets these naive values in the *reader's* local
// zone, so on a CEST machine every stored 07:58:48 came back as 05:58:48Z — two
// hours early, silently, for every timestamp column in the schema. That cost an
// hour of chasing a phantom clock bug: a signup whose DKIM-signed notification
// said 09:58 CEST read as 07:58 here. `timestamptz` columns and now() were
// unaffected, which is exactly what made it look like a data problem.
// 1114 = timestamp, 1115 = timestamp[].
pg.types.setTypeParser(1114, value => new Date(value + 'Z'))

const connectionString = process.env.DATABASE_URL

const query = process.argv[2]

if (!query) {
  console.error('Usage: node scripts/db-query.mjs "SELECT * FROM users LIMIT 5"')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

try {
  await client.connect()
  const result = await client.query(query)

  if (result.rows.length === 0) {
    console.log('No rows returned')
  } else {
    console.table(result.rows)
  }
} catch (error) {
  console.error('Query failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
