// Simple admin user seeder
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
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
  const hashedPassword = await bcrypt.hash('letseducate', 12)

  await prisma.user.create({
    data: {
      email: 'eduadmin@eduskript.org',
      name: 'Edu Admin',
      subdomain: 'eduadmin',
      hashedPassword,
      emailVerified: new Date(),
      isAdmin: true,
      requirePasswordReset: true
    }
  })

  console.log('✅ Admin user created: eduadmin@eduskript.org / letseducate')
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
