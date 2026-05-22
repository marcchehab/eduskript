/**
 * Exam Token Utilities for SEB Authentication
 *
 * One-time tokens allow users to authenticate inside Safe Exam Browser
 * without logging in again. The flow:
 * 1. Logged-in user clicks "Open in SEB"
 * 2. Server generates one-time token embedded in startURL
 * 3. SEB opens URL with token
 * 4. Server validates token, creates session, user sees exam
 *
 * Security:
 * - Token expires in 15 minutes
 * - Token is one-time use (consumed on first request)
 * - Token is tied to specific page (can't reuse for other exams)
 * - Only plaintext hash stored in DB (never the token itself)
 * - Only works from SEB (validated by caller)
 */

import { randomBytes, createHash } from 'crypto'
import { prisma } from './prisma'

const TOKEN_EXPIRY_MINUTES = 15

/**
 * Generate a one-time exam token for SEB authentication
 *
 * @param userId - The user requesting the token
 * @param pageId - The exam page the token is for
 * @returns The plaintext token (never stored) and expiration time
 */
export async function generateExamToken(
  userId: string,
  pageId: string
): Promise<{ token: string; expiresAt: Date }> {
  // Generate cryptographically secure random token
  const token = randomBytes(32).toString('hex')

  // Hash the token for storage (we never store plaintext)
  const tokenHash = createHash('sha256').update(token).digest('hex')

  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000)

  // Store the hash in database
  await prisma.examToken.create({
    data: {
      tokenHash,
      userId,
      pageId,
      expiresAt,
    },
  })

  return { token, expiresAt }
}

/**
 * Validate a one-time exam token
 *
 * Checks that:
 * - Token exists and matches hash
 * - Token is not expired
 * - Token is for the correct page
 * - Token has not been used before (when consume=true)
 *
 * When consume=true (default), marks the token as used atomically.
 * When consume=false, validates without consuming — useful for config
 * downloads where SEB may make multiple requests to the same URL.
 *
 * @param token - The plaintext token from the URL
 * @param pageId - The page being accessed (must match token's page)
 * @param consume - Whether to mark the token as used (default: true)
 * @returns The userId if valid, null if invalid/expired/used
 */
export async function validateExamToken(
  token: string,
  pageId: string,
  consume: boolean = true
): Promise<string | null> {
  // Hash the provided token to look up in DB
  const tokenHash = createHash('sha256').update(token).digest('hex')

  if (consume) {
    // Atomic update - only succeeds if token is valid AND unused
    // This prevents race conditions where multiple requests could use the same token
    const result = await prisma.examToken.updateMany({
      where: {
        tokenHash,
        pageId,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      data: { usedAt: new Date() },
    })

    if (result.count === 0) {
      return null // Token doesn't exist, wrong page, expired, or already used
    }

    // Fetch the userId (token is now consumed)
    const examToken = await prisma.examToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    })

    return examToken?.userId ?? null
  }

  // Non-consuming validation: check token is valid and not expired
  // Allows multiple uses within the expiry window (e.g., SEB retries)
  const examToken = await prisma.examToken.findUnique({
    where: { tokenHash },
    select: { userId: true, pageId: true, expiresAt: true },
  })

  if (!examToken) return null
  if (examToken.pageId !== pageId) return null
  if (examToken.expiresAt <= new Date()) return null

  return examToken.userId
}

/**
 * Clean up expired tokens (optional maintenance)
 *
 * Call periodically to remove old tokens from the database.
 * Not strictly necessary as validation checks expiry.
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.examToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { usedAt: { not: null } },
      ],
    },
  })

  return result.count
}

// ============================================================================
// Exam Session Functions
// ============================================================================
// Exam sessions persist authentication across page navigations during an exam.
// After one-time token auth, a session is created that allows access to all
// pages within the same skript.

const EXAM_SESSION_DURATION_HOURS = 4

/**
 * Create an exam session after successful token authentication
 *
 * @param userId - The authenticated user
 * @param pageId - The exam page that initiated the session
 * @param skriptId - The skript containing the exam (all pages accessible)
 * @returns The session ID to store in a cookie
 */
export async function createExamSession(
  userId: string,
  pageId: string,
  skriptId: string
): Promise<string> {
  const sessionId = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + EXAM_SESSION_DURATION_HOURS * 60 * 60 * 1000)

  await prisma.examSession.create({
    data: {
      sessionId,
      userId,
      pageId,
      skriptId,
      expiresAt,
    },
  })

  // Append-only audit log: pair with later "submitted" rows to compute
  // total time-on-exam for the teacher roster. Fire-and-forget — never
  // block exam entry on a log failure.
  prisma.examAuditLog
    .create({ data: { pageId, studentId: userId, event: 'started' } })
    .catch((err) => console.error('[exam-audit] failed to log started:', err))

  // Probabilistic cleanup - 1% chance on each session creation
  if (Math.random() < 0.01) {
    cleanupExpiredSessions().catch(console.error)
    cleanupExpiredTokens().catch(console.error)
  }

  return sessionId
}

/**
 * Exam session data returned by validateExamSession
 */
export interface ExamSessionData {
  userId: string
  pageId: string
  skriptId: string
  expiresAt: Date
}

/**
 * Validate an exam session from cookie
 *
 * Overloads:
 * - validateExamSession(sessionId): Returns full session data if valid
 * - validateExamSession(sessionId, skriptId): Returns userId if valid and matches skript
 *
 * Checks that:
 * - Session exists
 * - Session is not expired
 * - (if skriptId provided) Requested page is in the same skript as the session
 */
export async function validateExamSession(
  sessionId: string
): Promise<ExamSessionData | null>
export async function validateExamSession(
  sessionId: string,
  skriptId: string
): Promise<string | null>
export async function validateExamSession(
  sessionId: string,
  skriptId?: string
): Promise<ExamSessionData | string | null> {
  const session = await prisma.examSession.findUnique({
    where: { sessionId },
    select: {
      userId: true,
      pageId: true,
      skriptId: true,
      expiresAt: true,
    },
  })

  if (!session) {
    return null
  }

  if (session.expiresAt < new Date()) {
    // Session expired, clean it up
    await prisma.examSession.delete({ where: { sessionId } }).catch(() => {})
    return null
  }

  // If skriptId provided, verify it matches and return just userId (original behavior)
  if (skriptId !== undefined) {
    if (session.skriptId !== skriptId) {
      return null // Session is for a different skript
    }
    return session.userId
  }

  // No skriptId provided, return full session data
  return {
    userId: session.userId,
    pageId: session.pageId,
    skriptId: session.skriptId,
    expiresAt: session.expiresAt,
  }
}

/**
 * Delete an exam session (on quit)
 *
 * @param sessionId - The session ID to delete
 */
export async function deleteExamSession(sessionId: string): Promise<void> {
  await prisma.examSession.delete({
    where: { sessionId },
  }).catch(() => {
    // Session might not exist, that's fine
  })
}

/**
 * Clean up expired exam sessions
 */
async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.examSession.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  })

  return result.count
}
