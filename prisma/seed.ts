import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seeding database with admin user...')

  // Hash for password 'letseducate'
  const hashedPassword = await bcrypt.hash('letseducate', 12)

  // Create or update admin user
  const admin = await prisma.user.upsert({
    where: { email: 'eduadmin@eduskript.org' },
    update: {
      hashedPassword,
      emailVerified: new Date(),
      isAdmin: true,
      requirePasswordReset: true,
    },
    create: {
      email: 'eduadmin@eduskript.org',
      name: 'Edu Admin',
      username: 'eduadmin',
      hashedPassword,
      emailVerified: new Date(),
      isAdmin: true,
      requirePasswordReset: true,
    }
  })

  console.log('')
  console.log('✅ Admin user seeded successfully!')
  console.log('')
  console.log('👤 Admin Credentials:')
  console.log('   Email:    eduadmin@eduskript.org')
  console.log('   Password: letseducate')
  console.log('   Username: eduadmin')
  console.log('')
  console.log('⚠️  You will be required to reset the password on first login')
  console.log('')
  console.log('🎯 Next Steps:')
  console.log('   1. Sign in with the admin credentials')
  console.log('   2. Click "Insert Example Data" in the page builder to add sample content')
  console.log('   3. Explore the example algebra lessons with LaTeX math and Python code!')
  console.log('')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
