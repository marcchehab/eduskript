#!/usr/bin/env node
/**
 * Cleanup partial migration
 */

import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🧹 Cleaning up partial migration...\n')

  // Delete all skripts with slug starting with "programmieren"
  const skripts = await prisma.skript.findMany({
    where: {
      slug: {
        startsWith: 'programmieren'
      }
    },
    include: {
      pages: true
    }
  })

  for (const skript of skripts) {
    console.log(`Deleting skript: ${skript.title} (${skript.pages.length} pages)`)
    await prisma.skript.delete({ where: { id: skript.id } })
  }

  // Find and delete the Grundjahr collection
  const collection = await prisma.collection.findFirst({
    where: { title: 'Grundjahr' }
  })

  if (collection) {
    console.log(`Deleting collection: ${collection.title}`)
    await prisma.collection.delete({
      where: { id: collection.id }
    })
  }

  console.log('✅ Cleanup complete!')

  await prisma.$disconnect()
  await pool.end()
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
