#!/usr/bin/env node
/**
 * Reset user password
 *
 * Usage:
 *   node scripts/reset-password.mjs <email> <new-password>
 *
 * Example:
 *   node scripts/reset-password.mjs eduadmin@eduskript.org password123
 */

import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

dotenv.config({ path: '.env.local' })
dotenv.config()

const email = process.argv[2]
const newPassword = process.argv[3]

if (!email || !newPassword) {
  console.error('❌ Error: Email and password are required')
  console.error('\nUsage: node scripts/reset-password.mjs <email> <new-password>')
  console.error('\nExample: node scripts/reset-password.mjs eduadmin@eduskript.org password123')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL environment variable is not set')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log(`🔐 Resetting password for: ${email}\n`)

  // Find user
  const user = await prisma.user.findUnique({
    where: { email }
  })

  if (!user) {
    console.error(`❌ Error: User with email "${email}" not found`)
    await prisma.$disconnect()
    await pool.end()
    process.exit(1)
  }

  console.log(`✅ Found user: ${user.name || 'No name'} (${user.email})`)

  // Hash password
  const hashedPassword = await bcrypt.hash(newPassword, 10)

  // Update password
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword: hashedPassword }
  })

  console.log(`✅ Password updated successfully!`)
  console.log(`\n📝 Login credentials:`)
  console.log(`   Email: ${email}`)
  console.log(`   Password: ${newPassword}`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch((error) => {
  console.error('💥 Failed:', error.message)
  process.exit(1)
})
