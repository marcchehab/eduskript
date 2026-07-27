// Seed Eduskript organization and add all users as members.
// The URL slug lives on Site, not Organization (multi-site refactor), so the
// org is looked up through its Site row.
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const EDUSKRIPT_ORG_SLUG = 'eduskript'

async function main() {
  console.log('Setting up Eduskript organization...')

  // Slugs live on Site — find the org through it.
  const site = await prisma.site.findUnique({
    where: { slug: EDUSKRIPT_ORG_SLUG },
    select: { organizationId: true },
  })

  let org = site?.organizationId
    ? await prisma.organization.findUnique({ where: { id: site.organizationId } })
    : null

  if (!org) {
    console.log('Creating Eduskript organization...')
    org = await prisma.organization.create({
      data: {
        name: 'Eduskript',
        billingPlan: 'free',
        site: {
          create: {
            slug: EDUSKRIPT_ORG_SLUG,
            pageName: 'Eduskript',
            pageDescription: 'The Eduskript platform organization',
          },
        },
      },
    })
    console.log('✅ Eduskript organization created')
  } else {
    console.log('Eduskript organization already exists')
  }

  // Get all users
  const users = await prisma.user.findMany({
    select: { id: true, isAdmin: true, email: true, name: true }
  })

  console.log(`Found ${users.length} users to add to organization`)

  // Add all users to the organization
  let ownersAdded = 0
  let membersAdded = 0
  let alreadyMembers = 0

  for (const user of users) {
    // Check if already a member
    const existingMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id
        }
      }
    })

    if (existingMembership) {
      alreadyMembers++
      continue
    }

    // Admin users become owners, others become members
    const role = user.isAdmin ? 'owner' : 'member'

    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role
      }
    })

    if (role === 'owner') {
      ownersAdded++
      console.log(`  Added ${user.email || user.name || user.id} as owner`)
    } else {
      membersAdded++
    }
  }

  console.log('========================================')
  console.log('✅ Eduskript organization setup complete!')
  console.log(`   Owners added:  ${ownersAdded}`)
  console.log(`   Members added: ${membersAdded}`)
  console.log(`   Already members: ${alreadyMembers}`)
  console.log('========================================')
}

main()
  .catch((e) => {
    console.error('Error setting up organization:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
