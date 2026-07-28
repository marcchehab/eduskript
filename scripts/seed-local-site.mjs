#!/usr/bin/env node
/**
 * Compose a production-shaped local site for the query-optimization sessions.
 *
 * Runs the existing seed scripts in dependency order and then adds the one
 * thing none of them cover: published public layers (annotations, snaps,
 * sticky notes), which every reader's page view fetches three times over.
 *
 * Re-runnable. Each underlying script is idempotent in its own way (upsert, or
 * delete-then-recreate), so repeated runs converge rather than duplicate.
 *
 *   node scripts/seed-local-site.mjs
 *
 * Accounts afterwards:
 *   eduadmin@eduskript.org / letseducate   admin
 *   teacher@eduskript.test / teacher123    teacher, site slug "teacher", pro
 *   demo@eduskript.org     / demodemo      teacher with 10 rich demo pages
 *   student1..5@eduskript.test / student123
 *
 * NOTE: on localhost the proxy resolves an unknown host to DEFAULT_ORG_SLUG
 * ("eduskript"), so /<siteSlug>/<skript>/<page> is served by the *org* route
 * (force-dynamic), not the ISR [domain] route. Both shapes matter — see
 * docs in the plan.
 */

import { spawnSync } from 'child_process'
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const STEPS = [
  ['npx', ['tsx', 'prisma/seed.ts'], 'admin (eduadmin@eduskript.org)'],
  ['node', ['scripts/seed-dev-teacher.mjs'], 'dev teacher + site'],
  ['node', ['scripts/seed-dev-student.mjs'], 'dev student'],
  ['node', ['scripts/seed-org.js'], 'eduskript org + memberships'],
  ['npx', ['tsx', 'scripts/reset-demo-user.ts'], 'demo teacher + 10 rich pages'],
  ['node', ['scripts/seed-e2e-exam.mjs'], 'class + staged exam + 3 students'],
  ['node', ['scripts/seed-rich-exam.mjs'], 'exam with fabricated submissions'],
]

for (const [cmd, args, label] of STEPS) {
  process.stdout.write(`\n▶ ${label}\n`)
  const res = spawnSync(cmd, args, { stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`✖ ${label} failed (exit ${res.status}) — continuing`)
  }
}

// ---------------------------------------------------------------------------
// Public layers. getPublicLayers() runs three queries per page render AND per
// /api/user-data/public/[pageId] fetch; with empty tables those return fast and
// hide the real cost, so seed realistic volumes.
// ---------------------------------------------------------------------------

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

/** One stroke per entry; shape matches what the annotation layer writes. */
function strokes(count, seed) {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed-${seed}-${i}`,
    points: Array.from({ length: 24 }, (_, p) => ({
      x: 100 + ((i * 37 + p * 13) % 600),
      y: 150 + ((i * 53 + p * 7) % 400),
      pressure: 0.5,
    })),
    color: ['#e11d48', '#2563eb', '#16a34a'][i % 3],
    width: 3,
    sectionAnchor: null,
  }))
}

try {
  // Both seeded teachers — the demo site carries the rich content pages that
  // the browser session actually reads.
  const teachers = await prisma.user.findMany({
    where: { email: { in: ['teacher@eduskript.test', 'demo@eduskript.org'] } },
    select: { id: true, email: true },
  })
  if (teachers.length === 0) throw new Error('no seeded teachers — earlier step failed')

  const pages = []
  for (const t of teachers) {
    const own = await prisma.page.findMany({
      where: { authors: { some: { userId: t.id } } },
      select: { id: true, title: true },
      take: 6,
    })
    pages.push(...own.map(p => ({ ...p, teacherId: t.id })))
  }

  let written = 0
  for (const [i, page] of pages.entries()) {
    const teacher = { id: page.teacherId }
    for (const [adapter, data] of [
      ['annotations', { strokes: strokes(12 + i * 4, `ann${i}`) }],
      ['snaps', { snaps: [] }],
      // Shape must match StickyNote in src/components/annotations/
      // sticky-notes-layer.tsx — the layer calls content.trim() on render, so
      // a note missing `content` crashes the page rather than degrading.
      ['sticky-notes', {
        notes: Array.from({ length: 3 }, (_, n) => ({
          id: `seed-note-${i}-${n}`,
          content: `Seeded note ${n + 1} on ${page.title ?? page.id}`,
          x: 120 + n * 180,
          y: 220 + n * 40,
          color: ['yellow', 'blue', 'green'][n % 3],
          minimized: false,
          width: 200,
          height: 120,
          createdAt: 1753600000000,
          updatedAt: 1753600000000,
        })),
      }],
    ]) {
      const existing = await prisma.userData.findFirst({
        where: { adapter, itemId: page.id, targetType: 'page', userId: teacher.id },
        select: { id: true },
      })
      if (existing) {
        await prisma.userData.update({ where: { id: existing.id }, data: { data } })
      } else {
        await prisma.userData.create({
          data: {
            userId: teacher.id,
            adapter,
            itemId: page.id,
            targetType: 'page',
            data,
            version: 1,
          },
        })
      }
      written++
    }
  }

  console.log(`\n▶ public layers: ${written} rows across ${pages.length} pages`)

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.page.count(),
    prisma.userData.count(),
    prisma.class.count(),
  ])
  console.log(`\n✅ users=${counts[0]} pages=${counts[1]} user_data=${counts[2]} classes=${counts[3]}`)
  console.log('   Start with: QUERY_LOG=1 pnpm dev')
} finally {
  await pool.end()
}
