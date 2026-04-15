/**
 * One-shot migration: rewrite `<plugin src="<from>/...">` references to a
 * new owner pageSlug across all markdown-bearing tables.
 *
 * Defaults to dry-run. Pass --write to actually apply.
 *
 * Usage:
 *   node scripts/migrate-plugin-refs.mjs --from=eduadmin --to=informatikgarten
 *   node scripts/migrate-plugin-refs.mjs --from=eduadmin --to=informatikgarten --write
 *
 * Tables scanned: pages, page_versions, front_pages, front_page_versions.
 */

import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const TABLES = ['pages', 'page_versions', 'front_pages', 'front_page_versions']

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/)
      return m ? [m[1], m[2] ?? true] : [a, true]
    }),
  )
  if (!args.from || !args.to) {
    console.error('Usage: --from=<oldOwner> --to=<newOwner> [--write]')
    process.exit(1)
  }
  return { from: args.from, to: args.to, write: Boolean(args.write) }
}

async function main() {
  const { from, to, write } = parseArgs()
  const needle = `src="${from}/`
  const replacement = `src="${to}/`

  console.log(`${write ? 'WRITE MODE' : 'DRY RUN'}: ${needle} → ${replacement}\n`)

  let totalRows = 0
  let totalOccurrences = 0

  for (const table of TABLES) {
    // Count rows and total occurrences in this table
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, content FROM ${table} WHERE content LIKE $1`,
      `%${needle}%`,
    )

    const occurrences = rows.reduce((sum, r) => {
      return sum + (r.content.match(new RegExp(escapeRegex(needle), 'g')) || []).length
    }, 0)

    console.log(`${table}: ${rows.length} rows, ${occurrences} occurrences`)
    totalRows += rows.length
    totalOccurrences += occurrences

    // Show a snippet from the first row for sanity
    if (rows.length > 0) {
      const sample = rows[0]
      const idx = sample.content.indexOf(needle)
      const snippet = sample.content.slice(Math.max(0, idx - 20), idx + needle.length + 40)
      console.log(`  sample (id=${sample.id}): …${snippet}…`)
    }

    if (write && rows.length > 0) {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE ${table} SET content = REPLACE(content, $1, $2) WHERE content LIKE $3`,
        needle,
        replacement,
        `%${needle}%`,
      )
      console.log(`  → updated ${result} rows`)
    }
  }

  console.log(
    `\nTotal: ${totalRows} rows, ${totalOccurrences} occurrences ${write ? 'rewritten' : 'would be rewritten'}`,
  )
  if (!write) console.log('Re-run with --write to apply.')

  await prisma.$disconnect()
  await pool.end()
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
