/**
 * Reset demo user content from demo-content/ markdown files.
 *
 * Run: npx tsx scripts/reset-demo-user.ts
 *
 * Same reset the nightly cron runs (src/app/api/cron/route.ts), against
 * whatever DATABASE_URL points at. Deletes the demo user entirely — with it
 * everything a visitor created — then recreates the account and re-seeds from
 * the demo-content/ directory. See resetDemoUser() for what survives.
 */

// Loaded before the Pool is built — without this, running the file directly
// (npx tsx) leaves DATABASE_URL unset, the isLocal check below reads undefined,
// and the client tries TLS against a local Postgres that has none.
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import {
  resetDemoUser,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_SITE_SLUG,
} from '../src/lib/seed-demo-content.js'

// Initialize Prisma with pg adapter (same pattern as sync-docs.ts)
const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🔄 Resetting demo user content...')

  // Purge + recreate + re-seed. Everything the demo user owns cascades away
  // with the User row; see resetDemoUser().
  const result = await resetDemoUser(prisma)

  console.log(`   ✓ Seeded ${result.pageCount} pages across ${result.skriptIds.length} skripts`)
  console.log(`   Collection: ${result.collectionId}`)
  console.log(`   Skripts: ${result.skriptIds.join(', ')}`)
  console.log('\n✅ Demo user reset complete!')
  console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`   Public page: /${DEMO_SITE_SLUG}`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch(e => {
  console.error('❌ Reset failed:', e)
  process.exit(1)
})
