/**
 * Authentication Configuration
 *
 * Eduskript has two distinct authentication flows with different privacy models:
 *
 * ## Teacher Authentication
 *
 * Teachers can sign up/sign in via:
 * 1. **Email code** ('email-code' provider, src/lib/email-login.ts) - primary
 * 2. **Email/Password** (credentials) - from main site (/auth/login, /auth/register)
 * 3. **OAuth** (GitHub, Azure AD) - from main site
 *
 * Teacher accounts:
 * - Store real email addresses
 * - Get a public page (pageSlug)
 * - Can create content (collections, skripts, pages)
 * - Auto-join organizations by email domain
 *
 * ## Student Authentication
 *
 * Students sign in via an email code or a class-invite link ('email-code'
 * provider; only HMAC(email) is stored) or via OAuth. Account type for NEW
 * accounts comes from the signup context (src/lib/signup-context.ts):
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
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { generatePseudonym, isStudentEmail } from '@/lib/privacy/pseudonym'
import { PrivacyAdapter, type SignupContext } from '@/lib/privacy-adapter'
import { parseSignupContext } from '@/lib/signup-context'
import { cookies } from 'next/headers'
import { loginWithCode, loginWithInvite, normalizeEmail } from '@/lib/email-login'
import { emailCodeVerifyRateLimiter } from '@/lib/rate-limit'
import { expireSubscriptionIfNeeded } from '@/lib/trial'

export const authOptions: NextAuthOptions = {
  // Note: PrismaAdapter is incompatible with CredentialsProvider
  // Only use adapter when OAuth providers are configured
  // PrismaAdapter allows linking multiple OAuth providers to the same account
  // NOTE: If you're logged in and sign in with OAuth, it will link to your current account
  adapter: (process.env.GITHUB_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID)
    ? PrivacyAdapter({
        prisma: prismaBase,
        isStudentSignup: async (): Promise<SignupContext> => {
          const cookieStore = await cookies()
          const signupContextCookie = cookieStore.get('eduskript-signup-context')
          const rawValue = signupContextCookie?.value ? decodeURIComponent(signupContextCookie.value) : ''
          return parseSignupContext(rawValue)
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
    // Email-code login + class-invite links (src/lib/email-login.ts).
    // { email, code, context } → account by teacher email / student pseudonym,
    // created on first login. { inviteToken } → student by invite pseudonym.
    CredentialsProvider({
      id: 'email-code',
      name: 'email-code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
        context: { label: 'Context', type: 'text' },
        inviteToken: { label: 'Invite', type: 'text' },
      },
      async authorize(credentials, req) {
        const forwarded = req?.headers?.['x-forwarded-for']
        const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim()
          || (req?.headers?.['x-real-ip'] as string | undefined) || 'unknown'
        if (!emailCodeVerifyRateLimiter.check(ip).allowed) throw new Error('EMAIL_CODE_RATE_LIMITED')

        if (credentials?.inviteToken) {
          const user = await loginWithInvite(credentials.inviteToken)
          return { id: user.id, email: user.email, name: user.name, image: user.image }
        }
        const email = normalizeEmail(credentials?.email)
        const code = credentials?.code?.trim()
        if (!email || !code || !/^\d{6}$/.test(code)) throw new Error('EMAIL_CODE_INVALID')
        const user = await loginWithCode(email, code, credentials?.context)
        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
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
                // Sign-in only: no offline_access (we keep no refresh token) and
                // no Microsoft Graph scopes.
                scope: 'openid profile email',
                prompt: 'select_account' // Always show account selector
              }
            },
            // Replaces the provider's default profile(), which fetches the photo
            // from Microsoft Graph on every sign-in. Claims come from the ID token.
            profile(profile) {
              return { id: profile.sub, name: profile.name, email: profile.email, image: null }
            }
          })
        ]
      : []),
  ],
  session: {
    strategy: 'jwt',
  },
  // Cookie configuration for production behind the reverse proxy (Caddy → kamal-proxy)
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
    async jwt({ token, user, trigger, account, profile }) {
      if (user) {
        token.id = user.id
        // Record last login timestamp here, not in the signIn callback: on a
        // first OAuth login signIn runs before the adapter creates the user
        // (user.id is not a DB id yet), so the update silently failed and
        // OAuth users showed "never signed in" until their second login.
        // updateMany so a missing row can't throw; failure must not block sign-in.
        try {
          await prisma.user.updateMany({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
        } catch (err) {
          console.error('Failed to update lastLoginAt:', err)
        }
        // Fetch additional user data once during sign-in and store in token.
        // URL slug + page-display fields all live on Site now (Stage 5).
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            title: true,
            bio: true,
            isAdmin: true,
            requirePasswordReset: true,
            needsProfileCompletion: true,
            accountType: true,
            studentPseudonym: true,
            billingPlan: true,
            // A user may own multiple sites; the token carries the PRIMARY
            // site (lowest order) for the post-login redirect and legacy
            // single-slug fallbacks. The dashboard resolves the active site by
            // route param, not from the token.
            sites: {
              orderBy: PRIMARY_SITE_ORDER,
              take: 1,
              select: {
                slug: true,
                pageName: true,
                pageDescription: true,
                pageIcon: true,
                typographyPreference: true,
              },
            },
          }
        })

        if (dbUser) {
          token.pageSlug = dbUser.sites[0]?.slug ?? null
          token.pageName = dbUser.sites[0]?.pageName ?? null
          token.pageDescription = dbUser.sites[0]?.pageDescription ?? null
          token.pageIcon = dbUser.sites[0]?.pageIcon ?? null
          token.title = dbUser.title
          token.bio = dbUser.bio
          token.name = dbUser.name
          token.email = dbUser.email

          // Students have no image; teachers use the stored one (manual upload).
          token.image = dbUser.accountType === 'student' ? null : dbUser.image
          token.isAdmin = dbUser.isAdmin
          token.requirePasswordReset = dbUser.requirePasswordReset
          token.needsProfileCompletion = dbUser.needsProfileCompletion
          token.accountType = dbUser.accountType
          token.studentPseudonym = dbUser.studentPseudonym
          token.billingPlan = dbUser.billingPlan
          token.typographyPreference = dbUser.sites[0]?.typographyPreference ?? null

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

      // The JWT callback fires on every session check, including the implicit
      // /api/auth/session GET that NextAuth runs on each page load. Without
      // throttling, it chains 2-3 serial DB queries (expire check + user
      // refresh) on every navigation; on cold connections that's enough to
      // exhaust pool acquire timeouts and produce the "30s pre-auth hang"
      // visitors observed (logged-out UI flips to logged-in only after the
      // queries return). We refresh at most once per SESSION_REFRESH_INTERVAL
      // and stash the timestamp on the token. The `update` trigger (client
      // explicitly calls `update()`) bypasses the cache so admin changes to
      // billingPlan/isAdmin propagate on demand. On fresh signin (`user`
      // truthy) we skip too because the bigger fetch above already populated
      // billingPlan/isAdmin.
      const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000
      const nowMs = Date.now()
      const lastRefreshAt = token.dbRefreshedAt ?? 0
      const cacheStale = nowMs - lastRefreshAt > SESSION_REFRESH_INTERVAL_MS

      if (token.id && trigger !== 'update' && !user && cacheStale) {
        // Expire trial if past due — runs before billingPlan refresh so the
        // token picks up the downgrade immediately
        await expireSubscriptionIfNeeded(token.id as string)

        // Refresh billingPlan + isAdmin so admin-side changes propagate
        // without forcing the user to re-authenticate.
        const freshUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { billingPlan: true, isAdmin: true }
        })
        if (freshUser) {
          token.billingPlan = freshUser.billingPlan
          token.isAdmin = freshUser.isAdmin
        }
        token.dbRefreshedAt = nowMs
      } else if (user) {
        // Fresh signin path already fetched everything — record the
        // timestamp so the next session check doesn't redo the work.
        token.dbRefreshedAt = nowMs
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
            title: true,
            bio: true,
            isAdmin: true,
            requirePasswordReset: true,
            needsProfileCompletion: true,
            accountType: true,
            studentPseudonym: true,
            billingPlan: true,
            // A user may own multiple sites; the token carries the PRIMARY
            // site (lowest order) for the post-login redirect and legacy
            // single-slug fallbacks. The dashboard resolves the active site by
            // route param, not from the token.
            sites: {
              orderBy: PRIMARY_SITE_ORDER,
              take: 1,
              select: {
                slug: true,
                pageName: true,
                pageDescription: true,
                pageIcon: true,
                typographyPreference: true,
              },
            },
          }
        })

        if (dbUser) {
          token.pageSlug = dbUser.sites[0]?.slug ?? null
          token.pageName = dbUser.sites[0]?.pageName ?? null
          token.pageDescription = dbUser.sites[0]?.pageDescription ?? null
          token.pageIcon = dbUser.sites[0]?.pageIcon ?? null
          token.title = dbUser.title
          token.bio = dbUser.bio
          token.name = dbUser.name
          token.email = dbUser.email
          // null also clears a photo left in JWTs issued before the Graph fetch was removed.
          token.image = dbUser.accountType === 'student' ? null : dbUser.image
          token.isAdmin = dbUser.isAdmin
          token.requirePasswordReset = dbUser.requirePasswordReset
          token.needsProfileCompletion = dbUser.needsProfileCompletion
          token.accountType = dbUser.accountType
          token.studentPseudonym = dbUser.studentPseudonym
          token.billingPlan = dbUser.billingPlan
          token.typographyPreference = dbUser.sites[0]?.typographyPreference ?? null
        }
      }

      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
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
