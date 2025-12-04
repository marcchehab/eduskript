import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'
import AzureADProvider from 'next-auth/providers/azure-ad'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generatePseudonym, isStudentEmail } from '@/lib/privacy/pseudonym'
import { PrivacyAdapter } from '@/lib/privacy-adapter'
import { cookies } from 'next/headers'

export const authOptions: NextAuthOptions = {
  // Note: PrismaAdapter is incompatible with CredentialsProvider
  // Only use adapter when OAuth providers are configured
  // PrismaAdapter allows linking multiple OAuth providers to the same account
  // NOTE: If you're logged in and sign in with OAuth, it will link to your current account
  adapter: (process.env.GITHUB_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID)
    ? PrivacyAdapter({
        prisma,
        isStudentSignup: async (email: string, context?: any) => {
          // Check if OAuth was initiated from a teacher's page (student signup)
          // We use the callback URL to determine this - if it starts with a teacher's pageSlug,
          // then this is a student signing up on that teacher's page
          try {
            const cookieStore = await cookies()
            const callbackCookie = cookieStore.get('next-auth.callback-url')
            const callbackUrl = callbackCookie?.value || ''

            console.log('[isStudentSignup] email:', email, 'callbackUrl:', callbackUrl)

            // Parse the callback URL to check if it's a teacher's page
            // Teacher pages start with /{pageSlug} where pageSlug is NOT a reserved route
            // Reserved routes: auth, api, dashboard, admin, _next, etc.
            const reservedPaths = ['auth', 'api', 'dashboard', 'admin', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml']

            // Extract the first path segment from the callback URL
            // URL might be relative (/eduadmin) or absolute (http://localhost:3000/eduadmin)
            let pathSegment = ''
            try {
              // Try to parse as full URL first
              const url = new URL(callbackUrl, 'http://dummy.com')
              const parts = url.pathname.split('/').filter(Boolean)
              pathSegment = parts[0] || ''
            } catch {
              // Fallback for relative URLs
              const parts = callbackUrl.split('/').filter(Boolean)
              pathSegment = parts[0] || ''
            }

            console.log('[isStudentSignup] pathSegment:', pathSegment)

            // If the path segment is reserved or empty, this is NOT a student signup
            if (!pathSegment || reservedPaths.includes(pathSegment.toLowerCase())) {
              console.log('[isStudentSignup] result: false (reserved or empty path)')
              return false
            }

            // Check if this path segment is a valid teacher's pageSlug
            const teacher = await prisma.user.findUnique({
              where: { pageSlug: pathSegment },
              select: { id: true, accountType: true }
            })

            const isStudent = teacher !== null && teacher.accountType === 'teacher'
            console.log('[isStudentSignup] teacher found:', teacher !== null, 'result:', isStudent)
            return isStudent
          } catch (e) {
            // If anything fails, default to teacher (main site behavior)
            console.log('[isStudentSignup] error:', e)
            return false
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
                scope: 'openid profile email offline_access',
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
    async signIn({ user, account, profile }) {
      // No cleanup needed - we now use callback URL instead of cookies
      return true
    },
    async jwt({ token, user, trigger, account }) {
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
          // For students, use OAuth image directly (not stored in DB for privacy)
          // For teachers, use stored image (allows manual upload override)
          token.image = dbUser.accountType === 'student' ? user.image : dbUser.image
          token.isAdmin = dbUser.isAdmin
          token.requirePasswordReset = dbUser.requirePasswordReset
          token.needsProfileCompletion = dbUser.needsProfileCompletion
          token.accountType = dbUser.accountType
          token.studentPseudonym = dbUser.studentPseudonym
          token.typographyPreference = dbUser.typographyPreference

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

      // Only refetch user data on update trigger (not on every session check)
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
        session.user.studentPseudonym = token.studentPseudonym as string | null
        session.user.typographyPreference = token.typographyPreference as string | null
        session.user.signedUpFromPageSlug = token.signedUpFromPageSlug as string | null
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
}
