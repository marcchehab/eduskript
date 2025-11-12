/**
 * Test Database Utilities
 *
 * Provides utilities for setting up and managing in-memory SQLite databases
 * for integration tests. Uses Prisma for schema management and seeding.
 */

import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import { vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Store active test database instances
const testDatabases = new Map<string, { prisma: PrismaClient; dbPath: string }>()

/**
 * Creates a new in-memory SQLite database with the Prisma schema applied
 * @returns Object containing the Prisma client and database path
 */
export async function createTestDatabase(): Promise<{
  prisma: PrismaClient
  dbPath: string
  cleanup: () => Promise<void>
}> {
  // Generate unique database file name
  const dbId = randomBytes(16).toString('hex')
  const dbPath = path.join(process.cwd(), `.test-db-${dbId}.db`)

  // Set environment variable for this test database
  const originalUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = `file:${dbPath}`

  try {
    // Push schema to the new database (faster than migrations for testing)
    execSync('pnpm prisma db push --skip-generate', {
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
      },
    })

    // Create Prisma client for this database
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${dbPath}`,
        },
      },
    })

    await prisma.$connect()

    // Store reference for cleanup
    testDatabases.set(dbId, { prisma, dbPath })

    // Cleanup function
    const cleanup = async () => {
      await prisma.$disconnect()
      testDatabases.delete(dbId)

      // Remove database file
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath)
        }
        // Remove journal files if they exist
        const journalPath = `${dbPath}-journal`
        if (fs.existsSync(journalPath)) {
          fs.unlinkSync(journalPath)
        }
      } catch (error) {
        console.error(`Failed to delete test database: ${error}`)
      }

      // Restore original DATABASE_URL
      if (originalUrl) {
        process.env.DATABASE_URL = originalUrl
      }
    }

    return { prisma, dbPath, cleanup }
  } catch (error) {
    // Restore original URL if setup fails
    if (originalUrl) {
      process.env.DATABASE_URL = originalUrl
    }
    throw error
  }
}

/**
 * Seeds a test database with common test data
 * @param prisma - Prisma client instance
 * @returns Object containing IDs of created test data
 */
export async function seedTestData(prisma: PrismaClient) {
  // Create test users
  const user1 = await prisma.user.create({
    data: {
      email: 'test1@example.com',
      hashedPassword: 'hashed_password_1',
      subdomain: 'test1',
      emailVerified: new Date(),
    },
  })

  const user2 = await prisma.user.create({
    data: {
      email: 'test2@example.com',
      hashedPassword: 'hashed_password_2',
      subdomain: 'test2',
      emailVerified: new Date(),
    },
  })

  const user3 = await prisma.user.create({
    data: {
      email: 'test3@example.com',
      hashedPassword: 'hashed_password_3',
      subdomain: 'test3',
      // emailVerified: null (unverified user for auth tests)
    },
  })

  // Create test collection
  const collection = await prisma.collection.create({
    data: {
      title: 'Test Collection',
      slug: 'test-collection',
      description: 'A test collection',
      isPublished: true,
      authors: {
        create: [
          {
            userId: user1.id,
            permission: 'author',
          },
          {
            userId: user2.id,
            permission: 'viewer',
          },
        ],
      },
    },
  })

  // Create test skript
  const skript = await prisma.skript.create({
    data: {
      title: 'Test Skript',
      slug: 'test-skript',
      description: 'A test skript',
      isPublished: true,
      collectionSkripts: {
        create: {
          collectionId: collection.id,
          order: 0,
        },
      },
      authors: {
        create: [
          {
            userId: user1.id,
            permission: 'author',
          },
        ],
      },
    },
  })

  // Create test page
  const page = await prisma.page.create({
    data: {
      title: 'Test Page',
      slug: 'test-page',
      content: '# Test Page\n\nThis is a test page.',
      isPublished: true,
      skriptId: skript.id,
      order: 0,
      authors: {
        create: [
          {
            userId: user1.id,
            permission: 'author',
          },
        ],
      },
    },
  })

  // Create page version
  const pageVersion = await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      content: '# Test Page\n\nThis is test content.',
      version: 1,
      authorId: user1.id,
    },
  })

  return {
    users: { user1, user2, user3 },
    collection,
    skript,
    page,
    pageVersion,
  }
}

/**
 * Clears all data from the database
 * @param prisma - Prisma client instance
 */
export async function clearDatabase(prisma: PrismaClient) {
  // Delete in order of dependencies (child to parent)
  await prisma.pageVersion.deleteMany()
  await prisma.pageAuthor.deleteMany()
  await prisma.page.deleteMany()
  await prisma.skriptAuthor.deleteMany()
  await prisma.skript.deleteMany()
  await prisma.collectionAuthor.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.collaborationRequest.deleteMany()
  await prisma.collaboration.deleteMany()
  await prisma.file.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.verificationToken.deleteMany()
  await prisma.user.deleteMany()
}

/**
 * Cleanup function to disconnect all test databases
 * Call this in global teardown or afterAll
 */
export async function cleanupAllTestDatabases() {
  const promises = Array.from(testDatabases.values()).map(async ({ prisma, dbPath }) => {
    await prisma.$disconnect()
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath)
      }
      const journalPath = `${dbPath}-journal`
      if (fs.existsSync(journalPath)) {
        fs.unlinkSync(journalPath)
      }
    } catch (error) {
      console.error(`Failed to delete test database: ${error}`)
    }
  })

  await Promise.all(promises)
  testDatabases.clear()
}

/**
 * Mock Prisma client for unit tests
 * Provides a typed mock object that can be used with vi.mocked()
 */
export function createMockPrismaClient() {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    collection: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    skript: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    page: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    pageVersion: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collectionAuthor: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    skriptAuthor: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    pageAuthor: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    collaboration: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    collaborationRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    file: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({})),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  } as any
}
