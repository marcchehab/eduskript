 
import type NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
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
      billingPlan?: string
      typographyPreference?: string | null
      signedUpFromPageSlug?: string | null // For students: the teacher page they signed up from
      oauthEmail?: string | null // For students: their real OAuth email (not stored in DB, only in token)
    }
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
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
    billingPlan?: string
    typographyPreference?: string | null
    signedUpFromPageSlug?: string | null // For students: the teacher page they signed up from
    oauthEmail?: string | null // For students: their real OAuth email (not stored in DB, only in token)
    /**
     * Unix-ms timestamp of the last time the JWT callback ran the
     * subscription-expiry check + the billingPlan/isAdmin refresh. Used to
     * throttle those queries so the session-check hot path doesn't chain
     * 2-3 serial DB roundtrips on every page navigation. See
     * src/lib/auth.ts:jwt for the cadence.
     */
    dbRefreshedAt?: number
  }
}
