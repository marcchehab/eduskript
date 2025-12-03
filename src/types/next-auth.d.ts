 
import type NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      // User identity
      username?: string | null
      // Page fields
      pageSlug?: string | null
      pageName?: string | null
      pageDescription?: string | null
      pageIcon?: string | null
      // Profile fields
      title?: string | null
      bio?: string | null
      isAdmin?: boolean
      requirePasswordReset?: boolean
      needsProfileCompletion?: boolean
      accountType?: string
      studentPseudonym?: string | null
      typographyPreference?: string | null
    }
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    // User identity
    username?: string | null
    // Page fields
    pageSlug?: string | null
    pageName?: string | null
    pageDescription?: string | null
    // Profile fields
    title?: string | null
    bio?: string | null
    isAdmin?: boolean
    requirePasswordReset?: boolean
    needsProfileCompletion?: boolean
    accountType?: string
    studentPseudonym?: string | null
    typographyPreference?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    // User identity
    username?: string | null
    // Page fields
    pageSlug?: string | null
    pageName?: string | null
    pageDescription?: string | null
    // Profile fields
    title?: string | null
    bio?: string | null
    isAdmin?: boolean
    requirePasswordReset?: boolean
    needsProfileCompletion?: boolean
    accountType?: string
    studentPseudonym?: string | null
    typographyPreference?: string | null
  }
}
