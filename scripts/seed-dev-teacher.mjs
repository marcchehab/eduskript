#!/usr/bin/env node
// Creates a proper DEV TEACHER you can log in with (email/password) to exercise
// the teacher UI — distinct from the platform admin (eduadmin), which is NOT
// meant to do teacher work. Paid plan so the ClassToolbar/grading UI is enabled,
// plus a Site so the teacher owns a public space.
//
//   Email: teacher@eduskript.test
//   Password: teacher123   ·   site slug: teacher
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const bcrypt = (await import('bcryptjs')).default
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

const EMAIL = 'teacher@eduskript.test'
const PASSWORD = 'teacher123'
const SITE_SLUG = 'teacher'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

try {
  const hashedPassword = await bcrypt.hash(PASSWORD, 12)
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { hashedPassword, emailVerified: new Date(), accountType: 'teacher', billingPlan: 'pro', requirePasswordReset: false },
    create: {
      email: EMAIL,
      name: 'Dev Teacher',
      accountType: 'teacher',
      billingPlan: 'pro',
      hashedPassword,
      emailVerified: new Date(),
    },
  })
  // Own a Site so the teacher has a public space (slug used in exam URLs).
  const existing = await prisma.site.findFirst({ where: { userId: user.id } })
  if (!existing) {
    await prisma.site.upsert({
      where: { slug: SITE_SLUG },
      update: { userId: user.id },
      create: { slug: SITE_SLUG, userId: user.id, pageName: 'Dev Teacher' },
    })
  }
  console.log('✅ dev teacher ready')
  console.log(`   Email:    ${EMAIL}`)
  console.log(`   Password: ${PASSWORD}`)
  console.log(`   Site:     /${SITE_SLUG}`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end()
}
