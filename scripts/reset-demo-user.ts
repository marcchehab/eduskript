/**
 * Reset demo user content from demo-content/ markdown files.
 *
 * Run: npx tsx scripts/reset-demo-user.ts
 *
 * Intended for nightly cron to keep the demo account fresh.
 * Finds or creates demo@eduskript.org, deletes existing demo content,
 * and re-seeds from the demo-content/ directory.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { seedDemoContent } from '../src/lib/seed-demo-content.js'

const DEMO_EMAIL = 'demo@eduskript.org'
const DEMO_PASSWORD = 'demodemo'
const DEMO_PAGE_SLUG = 'demo'

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

  // Find or create demo user
  let user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL }
  })

  if (!user) {
    console.log('   Creating demo user...')
    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12)
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        name: 'Demo Teacher',
        pageSlug: DEMO_PAGE_SLUG,
        pageName: 'Demo',
        accountType: 'teacher',
        hashedPassword,
        emailVerified: new Date(),
        billingPlan: 'pro',
      }
    })
    console.log(`   ✓ Created demo user: ${DEMO_EMAIL}`)
  } else {
    console.log(`   ✓ Found existing demo user: ${DEMO_EMAIL}`)
  }

  // Add to eduskript org if it exists and user isn't already a member
  const org = await prisma.organization.findUnique({
    where: { slug: 'eduskript' }
  })
  if (org) {
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id
        }
      }
    })
    if (!membership) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: 'member'
        }
      })
      console.log('   ✓ Added demo user to eduskript org')
    }
  }

  // Reset demo content
  const result = await seedDemoContent({
    userId: user.id,
    prisma,
    reset: true,
  })

  console.log(`   ✓ Seeded ${result.pageCount} pages`)
  console.log(`   Collection: ${result.collectionId}`)
  console.log(`   Skript: ${result.skriptId}`)
  console.log('\n✅ Demo user reset complete!')
  console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`   Public page: /demo`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch(e => {
  console.error('❌ Reset failed:', e)
  process.exit(1)
})
