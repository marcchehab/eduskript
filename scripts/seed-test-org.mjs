#!/usr/bin/env node
/**
 * Creates a test organization with a custom domain for testing routing.
 *
 * Usage: node scripts/seed-test-org.mjs
 *
 * This creates:
 * - Organization: "Test School" (slug: test-school)
 * - Custom domain: school.local → test-school org
 * - Test teacher: test-teacher (member of test-school)
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eduskript_dev',
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🏫 Creating test organization...')

  // Create or update test organization
  const org = await prisma.organization.upsert({
    where: { slug: 'test-school' },
    update: {},
    create: {
      id: 'test-org-' + Date.now(),
      name: 'Test School',
      slug: 'test-school',
      description: 'A test organization for routing tests',
    },
  })
  console.log(`✅ Organization: ${org.name} (slug: ${org.slug})`)

  // Create or update custom domain
  const domain = await prisma.customDomain.upsert({
    where: { domain: 'school.local' },
    update: { isVerified: true },
    create: {
      domain: 'school.local',
      organizationId: org.id,
      isVerified: true,
    },
  })
  console.log(`✅ Custom domain: ${domain.domain} → ${org.slug}`)

  // Create a test teacher user
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@test-school.local' },
    update: {},
    create: {
      email: 'teacher@test-school.local',
      name: 'Test Teacher',
      pageSlug: 'test-teacher',
      pageName: 'Test Teacher Page',
      accountType: 'teacher',
    },
  })
  console.log(`✅ Teacher: ${teacher.name} (pageSlug: ${teacher.pageSlug})`)

  // Add teacher as member of org
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: teacher.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: teacher.id,
      role: 'member',
    },
  })
  console.log(`✅ Added ${teacher.name} as member of ${org.name}`)

  console.log('')
  console.log('📋 Test URLs:')
  console.log('   With custom domain (add to /etc/hosts or use curl -H):')
  console.log('     curl -H "Host: school.local" http://localhost:3000/')
  console.log('     curl -H "Host: school.local" http://localhost:3000/test-teacher')
  console.log('')
  console.log('   Direct org URLs:')
  console.log('     http://localhost:3000/org/test-school')
  console.log('     http://localhost:3000/org/test-school/test-teacher')
  console.log('')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
