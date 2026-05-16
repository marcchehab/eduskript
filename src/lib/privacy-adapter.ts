/**
 * Privacy-Preserving NextAuth Adapter
 *
 * Wraps the standard Prisma adapter to handle student privacy requirements.
 * Eduskript needs to identify students across sessions without storing their
 * personal information (email addresses).
 *
 * ## Two Account Types
 *
 * **Teachers** (accountType: 'teacher'):
 * - Full email storage for login, collaboration, and communication
 * - Normal NextAuth behavior via PrismaAdapter
 * - Get a public page (pageSlug) for their content
 * - Auto-join organizations by email domain
 *
 * **Students** (accountType: 'student'):
 * - NO email stored in database (privacy requirement)
 * - Identified by OAuth provider info (oauthProvider + oauthProviderId)
 * - Get a studentPseudonym: deterministic hash of their email
 *   (allows teachers to match students without knowing their email)
 * - Anonymous display name generated randomly
 * - No public page
 *
 * ## How Student Identification Works
 *
 * ```
 * Student email: "alice@school.edu"
 *                      ↓
 *              generatePseudonym()
 *                      ↓
 * studentPseudonym: "9a8b7c6d..."  ← Stored in DB (irreversible hash)
 *
 * Teacher pre-authorizes: "alice@school.edu"
 *                      ↓
 *              generatePseudonym()
 *                      ↓
 * PreAuthorizedStudent.pseudonym: "9a8b7c6d..."  ← Matches the student!
 * ```
 *
 * The pseudonym allows teachers to pre-authorize students by email, and when
 * the student signs up, they can be matched without ever storing the email.
 *
 * ## Privacy Guarantees
 *
 * 1. Student emails are NEVER stored in the database
 * 2. Pseudonyms are one-way hashes (cannot recover email from pseudonym)
 * 3. OAuth profile images are passed through but not persisted
 * 4. Students choose whether to reveal identity to specific teachers
 *
 * ## Known Limitations
 *
 * 1. **Pseudonym collisions**: While SHA256 makes collisions extremely unlikely,
 *    two different emails could theoretically produce the same pseudonym.
 *    This would cause incorrect student matching but is practically impossible.
 *
 * 2. **OAuth provider dependency**: If a student's OAuth account is deleted or
 *    changes (e.g., new Microsoft account), they lose access to their Eduskript
 *    student account. There's no email-based recovery possible by design.
 *
 * 3. **No email verification for students**: Since we don't store student emails,
 *    we can't verify that they actually control the email. This is acceptable
 *    because student accounts have limited capabilities.
 *
 * 4. **Pre-authorization doesn't auto-enroll**: Students must manually accept
 *    class invitations even if pre-authorized. This is intentional for consent
 *    but adds friction to the onboarding flow.
 *
 * @see src/lib/privacy/pseudonym.ts for the hashing algorithm
 * @see src/lib/auth.ts for how isStudentSignup is determined
 */

import type { Adapter, AdapterUser, AdapterAccount } from 'next-auth/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'
import { generatePseudonym, getStableStudentNickname } from './privacy/pseudonym'
import { createLogger } from '@/lib/logger'
import { createTrialSubscription } from '@/lib/trial'

const log = createLogger('auth:create-user')

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
  // URL slugs live on Site (global uniqueness across users + orgs). Probe
  // by site.slug rather than user.pageSlug.
  const existing = await prisma.site.findUnique({
    where: { slug: baseSlug },
    select: { id: true }
  })

  if (!existing) {
    return baseSlug
  }

  for (let i = 2; i <= 100; i++) {
    const candidateSlug = `${baseSlug}-${i}`
    const exists = await prisma.site.findUnique({
      where: { slug: candidateSlug },
      select: { id: true }
    })
    if (!exists) {
      return candidateSlug
    }
  }

  return `${baseSlug}-${Date.now().toString(36)}`
}

/**
 * Structured signup context parsed from the signup cookie.
 * Determines account type and which org(s) to auto-join.
 */
export interface SignupContext {
  isStudent: boolean
  teacherSlug?: string  // signing up from a teacher's page
  orgSlug?: string      // signing up from an org page
}

interface PrivacyAdapterOptions {
  prisma: PrismaClient
  /**
   * Function to determine signup context (account type + org info)
   * based on the signup cookie set before OAuth redirect.
   */
  isStudentSignup?: (email: string, context?: any) => SignupContext | Promise<SignupContext>
}

/**
 * Auto-join organizations that have a matching email domain requirement
 * e.g., if an org has requireEmailDomain = "@school.edu" and user signs up with "john@school.edu",
 * they are automatically added as a member of that org.
 */
async function autoJoinOrgByEmailDomain(prisma: PrismaClient, userId: string, email: string): Promise<void> {
  try {
    // Extract domain from email (e.g., "@school.edu")
    const atIndex = email.lastIndexOf('@')
    if (atIndex === -1) return

    const emailDomain = email.substring(atIndex).toLowerCase() // e.g., "@school.edu"

    // Find all organizations that require this email domain
    const matchingOrgs = await prisma.organization.findMany({
      where: {
        requireEmailDomain: {
          equals: emailDomain,
          mode: 'insensitive', // Case-insensitive match
        },
      },
      select: { id: true, name: true },
    })

    if (matchingOrgs.length === 0) return

    // Add user to each matching organization
    for (const org of matchingOrgs) {
      // Check if already a member (shouldn't happen for new users, but be safe)
      const existing = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId,
          },
        },
      })

      if (!existing) {
        await prisma.organizationMember.create({
          data: {
            organizationId: org.id,
            userId,
            role: 'member',
          },
        })
        console.log(`[PrivacyAdapter] Auto-joined user ${userId} to org ${org.name} (email domain: ${emailDomain})`)
      }
    }
  } catch (error) {
    // Don't fail user creation if auto-join fails
    console.error('[PrivacyAdapter] Error auto-joining organization:', error)
  }
}

/**
 * Auto-join organizations based on signup context (teacher page or org page).
 * - From a teacher's page: join all orgs that teacher belongs to
 * - From an org page: join that specific org
 */
async function autoJoinOrgBySignupContext(
  prisma: PrismaClient,
  userId: string,
  context: SignupContext
): Promise<void> {
  try {
    let orgIds: string[] = []

    if (context.teacherSlug) {
      // Resolve teacher via their site → user → orgs they're a member of.
      const site = await prisma.site.findUnique({
        where: { slug: context.teacherSlug },
        select: {
          user: {
            select: {
              organizationMemberships: { select: { organizationId: true } },
            },
          },
        },
      })
      orgIds = site?.user?.organizationMemberships.map(m => m.organizationId) || []
    } else if (context.orgSlug) {
      // Resolve org via its site.
      const site = await prisma.site.findUnique({
        where: { slug: context.orgSlug },
        select: { organizationId: true },
      })
      if (site?.organizationId) {
        orgIds = [site.organizationId]
      }
    }

    for (const orgId of orgIds) {
      const existing = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId },
        },
      })

      if (!existing) {
        await prisma.organizationMember.create({
          data: {
            organizationId: orgId,
            userId,
            role: 'member',
          },
        })
        log.info(`Auto-joined user ${userId} to org ${orgId} (signup context: ${context.teacherSlug ? 'teacher page' : 'org page'})`)
      }
    }
  } catch (error) {
    // Don't fail user creation if auto-join fails
    console.error('[PrivacyAdapter] Error auto-joining org by signup context:', error)
  }
}

/**
 * Creates a privacy-preserving adapter that wraps PrismaAdapter
 * Students: OAuth-only, NO email storage
 * Teachers: Normal email storage
 */
export function PrivacyAdapter(options: PrivacyAdapterOptions): Adapter {
  const { prisma, isStudentSignup = (() => ({ isStudent: false })) as NonNullable<PrivacyAdapterOptions['isStudentSignup']> } = options
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
      const maskedEmail = user.email?.replace(/(.{2}).*(@.*)/, '$1***$2') || 'none'
      log.info(`Creating new user account for ${maskedEmail}`)

      // Get structured signup context (account type + org info)
      const signupContext = await isStudentSignup(user.email, user)
      log.info(`Account type decision: ${signupContext.isStudent ? 'STUDENT' : 'TEACHER'} for ${maskedEmail}`, {
        teacherSlug: signupContext.teacherSlug,
        orgSlug: signupContext.orgSlug,
      })

      if (signupContext.isStudent) {
        let createdUser
        try {
          const emailPseudonym = user.email ? generatePseudonym(user.email) : null
          // Deterministic from the pseudonym so the nickname is stable across
          // sessions/devices. The 4-char hex tail comes from chars 8-12 of
          // the same pseudonym — collisions need both the adj/phil pair AND
          // the tail to match, ~26M combinations.
          const anonymousName = emailPseudonym ? getStableStudentNickname(emailPseudonym) : null

          createdUser = await prisma.user.create({
            data: {
              name: anonymousName,
              accountType: 'student',
              studentPseudonym: emailPseudonym,
              lastSeenAt: new Date(),
            },
          })

          log.info(`Student account created: id=${createdUser.id}, name="${anonymousName}", pseudonym=${emailPseudonym?.substring(0, 8)}...`)
        } catch (error: any) {
          log.error(`Failed to create student account for ${maskedEmail}: ${error.message}`)
          throw error
        }

        // Auto-join orgs based on signup context (e.g., teacher's orgs)
        await autoJoinOrgBySignupContext(prisma, createdUser.id, signupContext)

        return {
          id: createdUser.id,
          email: `student_${createdUser.id}@eduskript.local`,
          emailVerified: null,
          name: createdUser.name,
          image: user.image,
        }
      }

      // Teacher account
      if (baseAdapter.createUser) {
        const createdUser = await baseAdapter.createUser(user as AdapterUser & Omit<AdapterUser, 'id'>)

        let pageSlug: string | null = null
        if (user.email) {
          const baseSlug = generateUsernameFromEmail(user.email)
          pageSlug = await findUniquePageSlug(prisma, baseSlug)
        }

        await prisma.user.update({
          where: { id: createdUser.id },
          data: {
            accountType: 'teacher',
            lastSeenAt: new Date(),
            needsProfileCompletion: true,
          },
        })

        // URL slug lives on Site — create the teacher's Site row if we
        // managed to pick one. New teachers without a Site will be prompted
        // to claim their page from the dashboard.
        if (pageSlug) {
          await prisma.site.create({
            data: { slug: pageSlug, userId: createdUser.id },
          })
        }

        log.info(`Teacher account created: id=${createdUser.id}, pageSlug="${pageSlug}", email=${maskedEmail}`)

        // Auto-start trial for teacher accounts (no-op if no default trial plan configured)
        await createTrialSubscription(createdUser.id)

        // Auto-join orgs by signup context (from org page or teacher page)
        await autoJoinOrgBySignupContext(prisma, createdUser.id, signupContext)

        // Also auto-join orgs by email domain (complementary — matches by email domain requirement)
        if (user.email) {
          await autoJoinOrgByEmailDomain(prisma, createdUser.id, user.email)
        }

        return createdUser
      }

      throw new Error('createUser not implemented in base adapter')
    },
  }
}

