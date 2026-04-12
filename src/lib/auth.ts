/**
 * Authentication Configuration
 *
 * Eduskript has two distinct authentication flows with different privacy models:
 *
 * ## Teacher Authentication
 *
 * Teachers can sign up/sign in via:
 * 1. **Email/Password** (credentials) - from main site (/auth/login, /auth/register)
 * 2. **OAuth** (GitHub, Azure AD) - from main site
 *
 * Teacher accounts:
 * - Store real email addresses
 * - Get a public page (pageSlug)
 * - Can create content (collections, skripts, pages)
 * - Auto-join organizations by email domain
 *
 * ## Student Authentication
 *
 * Students sign in ONLY via OAuth, from a teacher's page (e.g., /teacher-slug).
 * We detect student signups by checking the callback URL:
 *
 * ```
 * OAuth initiated from:
 *   /auth/login     → Teacher (main site)
 *   /teacher-slug   → Student (teacher's page)
 * ```
 *
 * Student accounts:
 * - NO email storage (privacy requirement)
 * - Identified by OAuth provider (oauthProvider + oauthProviderId)
 * - Get a studentPseudonym for teacher matching
 * - Cannot create content, only consume and annotate
 *
 * ## JWT Token Fields
 *
 * The session token includes:
 * - `id`: User ID
 * - `email`: Real email (teachers) or fake email (students)
 * - `accountType`: 'teacher' | 'student'
 * - `pageSlug`: Public page URL (teachers only)
 * - `isAdmin`: Site administrator flag
 * - `studentPseudonym`: Hash for teacher matching (students only)
 *
 * ## Why JWT Instead of Database Sessions?
 *
 * We use JWT strategy because the PrismaAdapter is incompatible with the
 * CredentialsProvider (NextAuth limitation). JWT also provides better
 * performance for serverless deployments.
 *
 * @see src/lib/privacy-adapter.ts for the student privacy implementation
 */

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'
import AzureADProvider from 'next-auth/providers/azure-ad'
import bcrypt from 'bcryptjs'
import { prisma, prismaBase } from '@/lib/prisma'
import { generatePseudonym, isStudentEmail } from '@/lib/privacy/pseudonym'
import { PrivacyAdapter, type SignupContext } from '@/lib/privacy-adapter'
import { cookies } from 'next/headers'
import { createLogger } from '@/lib/logger'
import { expireSubscriptionIfNeeded } from '@/lib/trial'

const log = createLogger('auth:student-detect')

export const authOptions: NextAuthOptions = {
  // Note: PrismaAdapter is incompatible with CredentialsProvider
  // Only use adapter when OAuth providers are configured
  // PrismaAdapter allows linking multiple OAuth providers to the same account
  // NOTE: If you're logged in and sign in with OAuth, it will link to your current account
  adapter: (process.env.GITHUB_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID)
    ? PrivacyAdapter({
        prisma: prismaBase,
        isStudentSignup: async (email: string, context?: any): Promise<SignupContext> => {
          // Parse structured signup cookie set before OAuth redirect.
          // Cookie values and their meanings:
          //   "student:<slug>"     → Student account (from teacher page)
          //   "student-org:<slug>" → Student account (from org page)
          //   "teacher-org:<slug>" → Teacher account (from org page "For Teachers" column)
          //   "teacher-signup"     → Teacher account (from /auth/signup OAuth)
          //   "teacher:<slug>"     → Student account (legacy compat — teacher page)
          //   "org:<slug>"         → Teacher account (legacy compat — org page)
          //   (no cookie)          → Student account (safety default)
          try {
            const cookieStore = await cookies()
            const signupContextCookie = cookieStore.get('eduskript-signup-context')
            const rawValue = signupContextCookie?.value ? decodeURIComponent(signupContextCookie.value) : ''

            log.info('Signup detection started', {
              email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
              cookieValue: rawValue || '(none)',
            })

            if (!rawValue) {
              // Safety default: no cookie → student account.
              // This prevents accidental teacher account creation.
              log.info('No signup context cookie — defaulting to STUDENT account (safety default)')
              return { isStudent: true }
            }

            // Explicit student context from teacher page
            if (rawValue.startsWith('student:')) {
              const teacherSlug = rawValue.substring(8)
              log.info(`Student signup from teacher page: teacherSlug="${teacherSlug}"`)
              return { isStudent: true, teacherSlug }
            }

            // Explicit student context from org page
            if (rawValue.startsWith('student-org:')) {
              const orgSlug = rawValue.substring(12)
              log.info(`Student signup from org page: orgSlug="${orgSlug}"`)
              return { isStudent: true, orgSlug }
            }

            // Explicit teacher context from org page
            if (rawValue.startsWith('teacher-org:')) {
              const orgSlug = rawValue.substring(12)
              log.info(`Teacher signup from org page: orgSlug="${orgSlug}"`)
              return { isStudent: false, orgSlug }
            }

            // Explicit teacher context from /auth/signup page
            if (rawValue === 'teacher-signup') {
              log.info('Teacher signup from /auth/signup page')
              return { isStudent: false }
            }

            // Legacy: "org:<slug>" → teacher account (old org page format)
            if (rawValue.startsWith('org:')) {
              const orgSlug = rawValue.substring(4)
              log.info(`Legacy org page signup: orgSlug="${orgSlug}" → TEACHER account`)
              return { isStudent: false, orgSlug }
            }

            // Legacy: "teacher:<slug>" or plain slug → student account (old teacher page format)
            const teacherSlug = rawValue.startsWith('teacher:') ? rawValue.substring(8) : rawValue

            // Verify this slug belongs to an existing teacher
            const teacher = await prisma.user.findUnique({
              where: { pageSlug: teacherSlug },
              select: { id: true, accountType: true, pageSlug: true }
            })

            const isStudent = teacher !== null && teacher.accountType === 'teacher'
            log.info(`Legacy teacher lookup for "${teacherSlug}": ${teacher ? `found (accountType=${teacher.accountType})` : 'not found'} → signing up as ${isStudent ? 'STUDENT' : 'TEACHER'}`)

            return {
              isStudent,
              teacherSlug: isStudent ? teacherSlug : undefined,
            }
          } catch (error) {
            // Safety default: errors → student account (prevents accidental teacher creation)
            log.error('Signup detection failed, defaulting to STUDENT (safety default)', { error })
            return { isStudent: true }
          }
        },
      })
    : undefined,
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user || !user.hashedPassword) {
          throw new Error('Invalid credentials')
        }

        // Check if email is verified
        if (!user.emailVerified) {
          throw new Error('Please verify your email address before signing in.')
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.hashedPassword
        )

        if (!isPasswordValid) {
          throw new Error('Invalid credentials')
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      }
    }),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          })
        ]
      : []),
    ...(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
            // Use 'common' to allow any Microsoft account (personal or work/school)
            // Use 'organizations' for work/school only, or 'consumers' for personal only
            // Or use specific AZURE_AD_TENANT_ID for single-tenant
            tenantId: process.env.AZURE_AD_TENANT_ID || 'common',
            authorization: {
              params: {
                scope: 'openid profile email User.Read offline_access',
                prompt: 'select_account' // Always show account selector
              }
            }
          })
        ]
      : []),
  ],
  session: {
    strategy: 'jwt',
  },
  // Cookie configuration for production behind reverse proxy (Koyeb)
  cookies: process.env.NODE_ENV === 'production' ? {
    sessionToken: {
      name: `__Secure-next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
      },
    },
    callbackUrl: {
      name: `__Secure-next-auth.callback-url`,
      options: {
        sameSite: 'lax',
        path: '/',
        secure: true,
      },
    },
    csrfToken: {
      name: `__Host-next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
      },
    },
  } : undefined,
  callbacks: {
    async signIn({ user }) {
      // Record last login timestamp. Failure must not block sign-in.
      if (user?.id) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
        } catch (err) {
          console.error('Failed to update lastLoginAt:', err)
        }
      }
      return true
    },
    async jwt({ token, user, trigger, account, profile }) {
      if (user) {
        token.id = user.id
        // Fetch additional user data once during sign-in and store in token
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            username: true,
            pageSlug: true,
            pageName: true,
            pageDescription: true,
            pageIcon: true,
            title: true,
            bio: true,
            isAdmin: true,
            requirePasswordReset: true,
            needsProfileCompletion: true,
            accountType: true,
            studentPseudonym: true,
            billingPlan: true,
            typographyPreference: true,
          }
        })

        if (dbUser) {
          token.username = dbUser.username
          token.pageSlug = dbUser.pageSlug
          token.pageName = dbUser.pageName
          token.pageDescription = dbUser.pageDescription
          token.pageIcon = dbUser.pageIcon
          token.title = dbUser.title
          token.bio = dbUser.bio
          token.name = dbUser.name
          token.email = dbUser.email

          // For students, fetch OAuth profile image (not stored in DB for privacy)
          // For teachers, use stored image (allows manual upload override)
          let oauthImage = (profile as any)?.image || (profile as any)?.picture || (profile as any)?.avatar_url || user.image

          // If no image yet and we have an Azure AD access token, fetch from Microsoft Graph API
          // The built-in provider fetch sometimes fails silently, so we do it explicitly here
          if (!oauthImage && account?.provider === 'azure-ad' && account?.access_token) {
            try {
              const photoResponse = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
                headers: { Authorization: `Bearer ${account.access_token}` }
              })
              if (photoResponse.ok) {
                const pictureBuffer = await photoResponse.arrayBuffer()
                const pictureBase64 = Buffer.from(pictureBuffer).toString('base64')
                oauthImage = `data:image/jpeg;base64,${pictureBase64}`
              }
            } catch {
              // Photo fetch failed - user may not have a profile photo set
            }
          }

          // GitHub uses avatar_url in profile
          if (!oauthImage && account?.provider === 'github' && (profile as any)?.avatar_url) {
            oauthImage = (profile as any).avatar_url
          }

          token.image = dbUser.accountType === 'student' ? oauthImage : dbUser.image
          token.isAdmin = dbUser.isAdmin
          token.requirePasswordReset = dbUser.requirePasswordReset
          token.needsProfileCompletion = dbUser.needsProfileCompletion
          token.accountType = dbUser.accountType
          token.studentPseudonym = dbUser.studentPseudonym
          token.billingPlan = dbUser.billingPlan
          token.typographyPreference = dbUser.typographyPreference

          // For students, store OAuth email in token (for display purposes, NOT stored in DB)
          // This allows showing the student their email when they need to share it with teachers
          if (dbUser.accountType === 'student' && user.email) {
            token.oauthEmail = user.email
          }

          // For students, extract and store the teacher page they signed up from (for signout redirect)
          if (dbUser.accountType === 'student' && account?.provider) {
            try {
              const cookieStore = await cookies()
              const callbackCookie = cookieStore.get('next-auth.callback-url')
              const callbackUrl = callbackCookie?.value || ''

              // Extract the first path segment (teacher's pageSlug)
              const reservedPaths = ['auth', 'api', 'dashboard', 'admin', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml']
              let pathSegment = ''
              try {
                const url = new URL(callbackUrl, 'http://dummy.com')
                const parts = url.pathname.split('/').filter(Boolean)
                pathSegment = parts[0] || ''
              } catch {
                const parts = callbackUrl.split('/').filter(Boolean)
                pathSegment = parts[0] || ''
              }

              // Only store if it's a valid teacher page slug
              if (pathSegment && !reservedPaths.includes(pathSegment.toLowerCase())) {
                token.signedUpFromPageSlug = pathSegment
              }
            } catch {
              // Ignore errors - signedUpFromPageSlug is optional
            }
          }

          // If this is an OAuth login and the user doesn't have a pseudonym yet,
          // generate one if it's a student account
          if (account?.provider && !dbUser.studentPseudonym && dbUser.email) {
            const accountType = isStudentEmail(dbUser.email) ? 'student' : 'teacher'
            const studentPseudonym = accountType === 'student' ? generatePseudonym(dbUser.email) : null

            // Update the user record with pseudonym and account type
            const updatedUser = await prisma.user.update({
              where: { id: user.id },
              data: {
                accountType,
                studentPseudonym,
                lastSeenAt: new Date(),
              },
              select: {
                accountType: true,
                studentPseudonym: true,
              }
            })

            token.accountType = updatedUser.accountType
            token.studentPseudonym = updatedUser.studentPseudonym
          } else {
            // Just update lastSeenAt for existing users
            await prisma.user.update({
              where: { id: user.id },
              data: { lastSeenAt: new Date() },
            })
          }
        }
      }

      // Backfill missing accountType for existing tokens (one-time migration)
      // This handles tokens created before accountType was added
      if (token.id && !token.accountType) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { accountType: true }
        })
        if (dbUser?.accountType) {
          token.accountType = dbUser.accountType
        }
      }

      // Expire trial if past due — runs before billingPlan refresh so the
      // token picks up the downgrade immediately
      if (token.id && trigger !== 'update') {
        await expireSubscriptionIfNeeded(token.id as string)
      }

      // Always refresh billingPlan and isAdmin from DB — these gate UI access
      // and can be changed by admins without the user re-authenticating
      if (token.id && trigger !== 'update') {
        const freshUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { billingPlan: true, isAdmin: true }
        })
        if (freshUser) {
          token.billingPlan = freshUser.billingPlan
          token.isAdmin = freshUser.isAdmin
        }
      }

      // Only refetch full user data on update trigger (not on every session check)
      if (trigger === 'update' && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            username: true,
            pageSlug: true,
            pageName: true,
            pageDescription: true,
            pageIcon: true,
            title: true,
            bio: true,
            isAdmin: true,
            requirePasswordReset: true,
            needsProfileCompletion: true,
            accountType: true,
            studentPseudonym: true,
            billingPlan: true,
            typographyPreference: true,
          }
        })

        if (dbUser) {
          token.username = dbUser.username
          token.pageSlug = dbUser.pageSlug
          token.pageName = dbUser.pageName
          token.pageDescription = dbUser.pageDescription
          token.pageIcon = dbUser.pageIcon
          token.title = dbUser.title
          token.bio = dbUser.bio
          token.name = dbUser.name
          token.email = dbUser.email
          // For students, preserve existing OAuth image (not stored in DB)
          // For teachers, use stored image (allows manual upload override)
          token.image = dbUser.accountType === 'student' ? token.image : dbUser.image
          token.isAdmin = dbUser.isAdmin
          token.requirePasswordReset = dbUser.requirePasswordReset
          token.needsProfileCompletion = dbUser.needsProfileCompletion
          token.accountType = dbUser.accountType
          token.studentPseudonym = dbUser.studentPseudonym
          token.billingPlan = dbUser.billingPlan
          token.typographyPreference = dbUser.typographyPreference
        }
      }

      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.username = token.username as string
        session.user.pageSlug = token.pageSlug as string
        session.user.pageName = token.pageName as string
        session.user.pageDescription = token.pageDescription as string
        session.user.pageIcon = token.pageIcon as string
        session.user.title = token.title as string
        session.user.bio = token.bio as string
        session.user.name = token.name as string
        session.user.email = token.email as string
        session.user.image = token.image as string
        session.user.isAdmin = token.isAdmin as boolean
        session.user.requirePasswordReset = token.requirePasswordReset as boolean
        session.user.needsProfileCompletion = token.needsProfileCompletion as boolean
        session.user.accountType = token.accountType as string
        session.user.billingPlan = token.billingPlan as string
        session.user.studentPseudonym = token.studentPseudonym as string | null
        session.user.typographyPreference = token.typographyPreference as string | null
        session.user.signedUpFromPageSlug = token.signedUpFromPageSlug as string | null
        session.user.oauthEmail = token.oauthEmail as string | null
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
}
