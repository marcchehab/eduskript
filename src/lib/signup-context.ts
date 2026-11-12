import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { SignupContext } from '@/lib/privacy-adapter'

const log = createLogger('auth:student-detect')

/**
 * Parse the signup-context value (cookie `eduskript-signup-context`, set by the
 * sign-in/sign-up pages before OAuth; passed as a credential by the email-code
 * login) into account type + org info. Used only when a NEW account is created.
 */
export async function parseSignupContext(rawValue: string): Promise<SignupContext> {
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
    log.info('Signup detection started', { cookieValue: rawValue || '(none)' })

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

    // Verify this slug belongs to an existing teacher (URL slugs live
    // on Site now; find the User behind that Site).
    const slugSite = await prisma.site.findUnique({
      where: { slug: teacherSlug },
      select: { user: { select: { id: true, accountType: true } } },
    })
    const teacher = slugSite?.user ?? null

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
}
