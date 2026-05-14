#!/usr/bin/env node
// Reset admin password to 'letseducate'
import { Pool } from 'pg'
import 'dotenv/config'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Local development - no SSL
  connectionTimeoutMillis: 10000,
})

async function main() {
  console.log('Resetting admin password...')

  const client = await pool.connect()
  try {
    // Update password for admin users
    // Password hash for 'letseducate'
    const result = await client.query(`
      UPDATE users
      SET "hashedPassword" = '$2b$12$VvRPkUbH2A4eaMnpaz0a/.egUaVxiKg.ilvNhR.sKQMXUeflRfNrK',
          "requirePasswordReset" = false,
          "updatedAt" = NOW()
      WHERE "isAdmin" = true
      RETURNING email
    `)

    if (result.rows.length > 0) {
      console.log('\n✅ Password reset for admin users:')
      result.rows.forEach(row => {
        console.log(`   - ${row.email}`)
      })
      console.log('\n🔑 New password: letseducate')
    } else {
      console.log('❌ No admin users found')
    }
  } finally {
    client.release()
  }
}

main()
  .catch((e) => {
    console.error('Error:', e.message)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
