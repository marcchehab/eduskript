#!/usr/bin/env node
// Direct SQL seeding script for admin user
// This bypasses Prisma client and uses raw SQL to avoid connection issues
import { Pool } from 'pg'
import 'dotenv/config'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

async function main() {
  console.log('Seeding admin user via SQL...')

  const client = await pool.connect()
  try {
    // Check if admin already exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1',
      ['eduadmin@eduskript.org']
    )

    if (existing.rows.length > 0) {
      console.log('✓ Admin user already exists')
      return
    }

    // Insert admin user with bcrypt hash for 'letseducate'
    await client.query(`
      INSERT INTO users (id, email, name, subdomain, "hashedPassword", "emailVerified", "isAdmin", "requirePasswordReset", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        'eduadmin@eduskript.org',
        'Edu Admin',
        'eduadmin',
        '$2b$12$VvRPkUbH2A4eaMnpaz0a/.egUaVxiKg.ilvNhR.sKQMXUeflRfNrK',
        NOW(),
        true,
        true,
        NOW(),
        NOW()
      )
    `)

    console.log('✅ Admin user created: eduadmin@eduskript.org / letseducate')
    console.log('⚠️  User must reset password on first login')
  } finally {
    client.release()
  }
}

main()
  .catch((e) => {
    console.error('Error seeding admin user:', e.message)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
