#!/usr/bin/env tsx
/**
 * Backfill legacy student nicknames.
 *
 * Existing students were created with `name = "Student abc1"` — a 4-char
 * random suffix. After the signup paths were switched to write the stable
 * "Adjective Philosopher xxxx" form, this script rewrites the legacy rows
 * to match. Idempotent: only touches names matching the legacy regex.
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

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'apply',
  scanned: candidates.length,
  updated,
  skippedNonLegacyShape: skippedShape,
  unchanged,
}, null, 2))

await prisma.$disconnect()
