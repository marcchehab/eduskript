import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Generates a stable pseudonymous identifier from an email address.
 *
 * This function creates a privacy-preserving identifier that:
 * - Is deterministic (same email always produces same pseudonym)
 * - Is verifiable (teachers can check if a pseudonym matches an email)
 * - Does not reveal the original email address
 * - Cannot be reversed to obtain the email
 *
 * @param email - The email address to generate a pseudonym for
 * @returns A 16-character hexadecimal pseudonym
 *
 * @example
 * generatePseudonym('student@example.com') // => 'a3f5b9c2d8e1f4a7'
 */
export function generatePseudonym(email: string): string {
  const secret = process.env.STUDENT_PSEUDONYM_SECRET

  if (!secret) {
    throw new Error('STUDENT_PSEUDONYM_SECRET environment variable is not set')
  }

  // Validate secret strength
  if (secret.length < 32) {
    throw new Error('STUDENT_PSEUDONYM_SECRET must be at least 32 characters for security')
  }

  // Check for weak/default values
  const weakSecrets = [
    'change-this-to-a-random-secret-in-production',
    'your-secret-key-here',
  ]
  if (weakSecrets.some(weak => secret.toLowerCase().includes(weak.toLowerCase()))) {
    throw new Error('STUDENT_PSEUDONYM_SECRET contains a weak or default value. Please use a strong random secret.')
  }

  // Normalize email to lowercase to ensure consistent pseudonyms
  const normalizedEmail = email.toLowerCase().trim()

  // Create HMAC-SHA256 hash
  const hmac = createHmac('sha256', secret)
  hmac.update(normalizedEmail)
  const hash = hmac.digest('hex')

  // Return full 64-character hash for maximum security
  // Using the full hash eliminates collision risks
  return hash
}

/**
 * Verifies if a pseudonym matches a given email address.
 *
 * This allows teachers to verify student identities by providing
 * an email address and checking if it matches a pseudonym they see
 * in the system.
 *
 * @param pseudonym - The pseudonym to verify
 * @param email - The email address to check against
 * @returns true if the pseudonym was generated from this email
 *
 * @example
 * const pseudonym = 'a3f5b9c2d8e1f4a7'
 * verifyStudentEmail(pseudonym, 'student@example.com') // => true
 * verifyStudentEmail(pseudonym, 'other@example.com')   // => false
 */
export function verifyStudentEmail(pseudonym: string, email: string): boolean {
  try {
    const generatedPseudonym = generatePseudonym(email)

    // Use constant-time comparison to prevent timing attacks
    // This ensures that the comparison time doesn't reveal information
    // about how many characters match

    // Convert strings to buffers for constant-time comparison
    const pseudonymBuffer = Buffer.from(pseudonym)
    const generatedBuffer = Buffer.from(generatedPseudonym)

    // If lengths don't match, return false (but still use constant-time)
    if (pseudonymBuffer.length !== generatedBuffer.length) {
      return false
    }

    // Use crypto.timingSafeEqual for constant-time comparison
    return timingSafeEqual(pseudonymBuffer, generatedBuffer)
  } catch (error) {
    console.error('Error verifying student email:', error)
    return false
  }
}

/**
 * Determines if an email belongs to a student account based on domain.
 *
 * This is a heuristic function that can be customized to identify student
 * emails. By default, it treats all emails as potential student accounts.
 * You can modify this to check for specific domains (e.g., school domains).
 *
 * @param email - The email address to check
 * @returns true if the email appears to be from a student account
 *
 * @example
 * isStudentEmail('student@school.edu') // => true
 * isStudentEmail('teacher@gmail.com')  // => false (if configured)
 */
export function isStudentEmail(email: string): boolean {
  // Default: all accounts are treated as potential students unless configured otherwise
  // Customize this function to match your institution's email patterns

  const normalizedEmail = email.toLowerCase().trim()

  // Example: Check if email is from a known student domain
  // const studentDomains = ['student.school.edu', 'pupils.school.ch']
  // return studentDomains.some(domain => normalizedEmail.endsWith('@' + domain))

  // For now, return false (let teachers be explicitly set as teachers)
  // Students will be auto-detected by OAuth provider or manual setting
  return false
}

/**
 * Generates a display name for a student without revealing their identity.
 *
 * @param pseudonym - The student's pseudonym
 * @returns A user-friendly display name
 *
 * @example
 * getStudentDisplayName('a3f5b9c2d8e1f4a7...') // => 'Student a3f5b9c2'
 */
export function getStudentDisplayName(pseudonym: string): string {
  // Use first 8 characters for better uniqueness while keeping brevity
  const shortId = pseudonym.substring(0, 8)
  return `Student ${shortId}`
}
