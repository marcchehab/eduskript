#!/usr/bin/env node
// Creates a dev STUDENT account you can log in with via the normal email/password
// form (students normally use OAuth, but the credentials provider authorizes any
// account with a hashedPassword + verified email — no accountType restriction).
// Exam pages with examSettings.unlockForAll let this student view them.
//
//   Email: student1@eduskript.test
//   Password: student123
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const bcrypt = (await import('bcryptjs')).default
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default

const EMAIL = 'student1@eduskript.test'
const PASSWORD = 'student123'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

try {
  const hashedPassword = await bcrypt.hash(PASSWORD, 12)
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: { hashedPassword, emailVerified: new Date() },
    create: {
      email: EMAIL,
      name: 'Student One',
      accountType: 'student',
      studentPseudonym: 'dev-student-1',
      hashedPassword,
      emailVerified: new Date(),
    },
  })
  console.log('✅ dev student ready')
  console.log(`   Email:    ${EMAIL}`)
  console.log(`   Password: ${PASSWORD}`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end()
}
