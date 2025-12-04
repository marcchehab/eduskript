/**
 * Privacy-preserving adapter wrapper for NextAuth
 * For students: NEVER stores emails, only OAuth provider info
 * For teachers: Stores emails normally
 */

import type { Adapter, AdapterUser, AdapterAccount } from 'next-auth/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'
import { generatePseudonym } from './privacy/pseudonym'

/**
 * Generates a username from an email address
 * e.g., "john.doe@example.com" -> "john-doe"
 */
function generateUsernameFromEmail(email: string): string {
  // Take the part before @
  const localPart = email.split('@')[0]

  // Normalize: lowercase, replace dots/underscores with hyphens, remove other special chars
  let username = localPart
    .toLowerCase()
    .replace(/[._]/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, '') // trim leading/trailing hyphens

  // Ensure minimum length
  if (username.length < 3) {
    username = `user-${username || 'x'}`
  }

  // Truncate if too long (leave room for potential suffix)
  if (username.length > 40) {
    username = username.substring(0, 40)
  }

  return username
}

/**
 * Finds a unique page slug, adding numeric suffix if needed (e.g., john-doe, john-doe-2, john-doe-3)
 */
async function findUniquePageSlug(prisma: PrismaClient, baseSlug: string): Promise<string> {
  // First try the base slug
  const existing = await prisma.user.findUnique({
    where: { pageSlug: baseSlug },
    select: { id: true }
  })

  if (!existing) {
    return baseSlug
  }

  // Add numeric suffix and try again (2, 3, 4, ...)
  for (let i = 2; i <= 100; i++) {
    const candidateSlug = `${baseSlug}-${i}`

    const exists = await prisma.user.findUnique({
      where: { pageSlug: candidateSlug },
      select: { id: true }
    })

    if (!exists) {
      return candidateSlug
    }
  }

  // Fallback: use timestamp (extremely unlikely to reach here)
  return `${baseSlug}-${Date.now().toString(36)}`
}

interface PrivacyAdapterOptions {
  prisma: PrismaClient
  /**
   * Function to determine if a user should be treated as a student
   * based on the signup context (e.g., domain, OAuth state)
   */
  isStudentSignup?: (email: string, context?: any) => boolean | Promise<boolean>
}

/**
 * Creates a privacy-preserving adapter that wraps PrismaAdapter
 * Students: OAuth-only, NO email storage
 * Teachers: Normal email storage
 */
export function PrivacyAdapter(options: PrivacyAdapterOptions): Adapter {
  const { prisma, isStudentSignup = () => false } = options
  const baseAdapter = PrismaAdapter(prisma) as Adapter

  return {
    ...baseAdapter,

    // Override linkAccount to capture OAuth info for students
    // @ts-ignore - Type mismatch between next-auth and @auth/prisma-adapter versions
    async linkAccount(account: any) {
      // Call base adapter to create Account record
      if (baseAdapter.linkAccount) {
        const result = await baseAdapter.linkAccount(account as any)

        // Update user with OAuth provider info if it's a student
        const user = await prisma.user.findUnique({
          where: { id: account.userId },
          select: { accountType: true, oauthProvider: true }
        })

        if (user?.accountType === 'student' && !user.oauthProvider) {
          // Store OAuth provider info (but keep email-based pseudonym for matching)
          await prisma.user.update({
            where: { id: account.userId },
            data: {
              oauthProvider: account.provider,
              oauthProviderId: account.providerAccountId,
              // DON'T overwrite studentPseudonym - it's email-based for teacher matching
            }
          })
        }

        return result
      }

      throw new Error('linkAccount not implemented in base adapter')
    },

    async createUser(user: Omit<AdapterUser, 'id'>) {
      // Check if this is a student signup
      console.log('[PrivacyAdapter.createUser] email:', user.email, 'calling isStudentSignup...')
      const isStudent = await isStudentSignup(user.email, user)
      console.log('[PrivacyAdapter.createUser] isStudent result:', isStudent)

      if (isStudent) {
        // CRITICAL: For students, NEVER store email
        // We'll get OAuth provider info from linkAccount callback

        let createdUser
        try {
          // Store anonymized display name
          const anonymousName = `Student ${Math.random().toString(36).substring(2, 6)}`

          // Generate pseudonym from email (for teacher matching) but DON'T store the email
          const emailPseudonym = user.email ? generatePseudonym(user.email) : null

          // Create user WITHOUT email
          createdUser = await prisma.user.create({
            data: {
              name: anonymousName,
              accountType: 'student',
              studentPseudonym: emailPseudonym, // Store email-based pseudonym for matching
              lastSeenAt: new Date(),
              // All optional fields with null defaults are omitted
              // (Prisma will set them to null automatically)
            },
          })
        } catch (error: any) {
          console.error('[PrivacyAdapter] Error creating student user:', error.message)
          throw error
        }

        // Note: PreAuthorizedStudent records are NOT auto-enrolled
        // Student will see them as join requests in their My Classes page
        // This allows them to choose whether to consent to identity reveal

        return {
          id: createdUser.id,
          email: `student_${createdUser.id}@eduskript.local`, // Return unique fake email for NextAuth
          emailVerified: null,
          name: createdUser.name,
          image: user.image, // Pass through OAuth image (not stored in DB for privacy)
        }
      }

      // For teachers, use the base adapter (stores real email)
      if (baseAdapter.createUser) {
        const createdUser = await baseAdapter.createUser(user as AdapterUser & Omit<AdapterUser, 'id'>)

        // Generate a unique page slug from email
        let pageSlug: string | null = null
        if (user.email) {
          const baseSlug = generateUsernameFromEmail(user.email)
          pageSlug = await findUniquePageSlug(prisma, baseSlug)
        }

        // Set account type to teacher and auto-generated page slug
        // Mark as needing profile completion so they can customize their page
        await prisma.user.update({
          where: { id: createdUser.id },
          data: {
            accountType: 'teacher',
            lastSeenAt: new Date(),
            pageSlug, // Auto-generated page slug for teachers
            needsProfileCompletion: true, // New OAuth teachers should complete their profile
          },
        })

        return createdUser
      }

      throw new Error('createUser not implemented in base adapter')
    },
  }
}

/**
 * Helper to extract domain context from OAuth callback
 * This will be set in the OAuth state parameter
 */
export function isStudentFromCallback(email: string, request?: any): boolean {
  // Check if the callback contains student indicator
  // This will be set when initiating OAuth from a subdomain
  if (request?.query?.student === 'true') {
    return true
  }

  // Check if the callback URL indicates a subdomain signup
  if (request?.url) {
    const url = new URL(request.url, 'http://dummy.com')
    const domain = url.searchParams.get('domain')
    return domain === 'subdomain'
  }

  return false
}
