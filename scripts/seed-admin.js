// Simple admin user seeder
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Checking for admin user...')

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'eduadmin@eduskript.org' }
  })

  if (existingAdmin) {
    console.log('Admin user already exists')
    return
  }

  console.log('Creating admin user...')

  // Generate a random password (16 chars, alphanumeric)
  const randomPassword = crypto.randomBytes(12).toString('base64').slice(0, 16)
  const hashedPassword = await bcrypt.hash(randomPassword, 12)

  // URL slug lives on Site now. Create user + Site atomically so the new
  // admin can be served from /eduadmin immediately.
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: 'eduadmin@eduskript.org',
        name: 'Edu Admin',
        hashedPassword,
        emailVerified: new Date(),
        isAdmin: true,
        requirePasswordReset: true,
      },
    })
    await tx.site.create({
      data: { slug: 'eduadmin', userId: u.id, pageName: 'Edu Admin' },
    })
  })

  console.log('========================================')
  console.log('✅ Admin user created!')
  console.log('   Email:    eduadmin@eduskript.org')
  console.log(`   Password: ${randomPassword}`)
  console.log('========================================')
  console.log('⚠️  User must reset password on first login')
}

main()
  .catch((e) => {
    console.error('Error creating admin user:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
