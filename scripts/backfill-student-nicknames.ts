#!/usr/bin/env tsx
/**
 * Backfill legacy + anonymous-survey student nicknames.
 *
 * Two passes:
 *   1. Legacy student accounts whose `name` matches `^Student [a-z0-9]{4}$`
 *      (the old eager-random pattern). Rewritten to the stable form.
 *   2. Anonymous survey shell users (`oauthProvider = 'survey'`) created
 *      before the signup path was patched — `name IS NULL`. Filled in with
 *      the same stable form. After this pass, every survey row in the
 *      teacher submissions toolbar has a friendly name; the UI no longer
 *      shows two `—` rows that the teacher can't tell apart.
 *
 * Idempotent: pass 1 only touches names matching the legacy regex; pass 2
 * only touches null names. Re-running is a no-op once converged.
 *
 * Usage:
 *   npx tsx scripts/backfill-student-nicknames.ts [--dry-run]
 *
 * Dry-run prints the planned changes without writing. Run locally first
 * to smoke-test; then on prod.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { getStableStudentNickname } from '../src/lib/privacy/pseudonym'

config()

const dryRun = process.argv.includes('--dry-run')

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eduskript_dev',
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// "Student " + 4 alnum chars. Exact shape minted by the old signup code.
const LEGACY_SHAPE = /^Student [a-z0-9]{4}$/

const candidates = await prisma.user.findMany({
  where: {
    accountType: 'student',
    name: { startsWith: 'Student ' },
    studentPseudonym: { not: null },
  },
  select: { id: true, name: true, studentPseudonym: true },
})

let updated = 0
let skippedShape = 0
let unchanged = 0

for (const u of candidates) {
  if (!u.name || !u.studentPseudonym) continue
  if (!LEGACY_SHAPE.test(u.name)) {
    // Real names like "Student Bob" — leave alone.
    skippedShape++
    continue
  }
  const next = getStableStudentNickname(u.studentPseudonym)
  if (next === u.name) {
    unchanged++
    continue
  }
  if (dryRun) {
    console.log(`[dry] ${u.id}: "${u.name}" -> "${next}"`)
  } else {
    // Explicit `select: { id: true }` keeps the RETURNING clause minimal.
    // Without it, Prisma returns every User column, which trips P2022 when
    // the local generated client lags schema-drift on prod (e.g. dropped
    // `username` column — see migration 20260514074911_drop_user_username).
    await prisma.user.update({
      where: { id: u.id },
      data: { name: next },
      select: { id: true },
    })
  }
  updated++
}

/* --- Pass 2: anonymous survey shell users with null name --- */

const anonCandidates = await prisma.user.findMany({
  where: {
    oauthProvider: 'survey',
    name: null,
    studentPseudonym: { not: null },
  },
  select: { id: true, studentPseudonym: true },
})

let anonUpdated = 0

for (const u of anonCandidates) {
  if (!u.studentPseudonym) continue
  const next = getStableStudentNickname(u.studentPseudonym)
  if (dryRun) {
    console.log(`[dry] ${u.id}: null -> "${next}" (anon survey)`)
  } else {
    await prisma.user.update({
      where: { id: u.id },
      data: { name: next },
      select: { id: true },
    })
  }
  anonUpdated++
}

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'apply',
  pass1: {
    scanned: candidates.length,
    updated,
    skippedNonLegacyShape: skippedShape,
    unchanged,
  },
  pass2: {
    scanned: anonCandidates.length,
    updated: anonUpdated,
  },
}, null, 2))

await prisma.$disconnect()
