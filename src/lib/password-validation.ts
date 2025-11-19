/**
 * Password Validation
 *
 * Enforces strong password requirements to prevent weak passwords
 * and improve account security.
 */

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
  strength: 'weak' | 'medium' | 'strong'
  score: number // 0-6
}

// Common passwords list (abbreviated - use a comprehensive list in production)
// Consider using the HaveIBeenPwned API for production
const COMMON_PASSWORDS = new Set([
  'password', 'password123', '12345678', 'qwerty', 'abc123',
  'password1', '123456789', '12345', '1234567', 'password!',
  'qwerty123', '1q2w3e4r', 'admin', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'sunshine', 'princess',
  'football', 'iloveyou', 'shadow', 'superman', 'batman',
])

/**
 * Validates password strength and compliance with security requirements
 * @param password - The password to validate
 * @returns Validation result with errors and strength assessment
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = []
  let score = 0

  // Minimum length check (REQUIRED)
  if (!password || password.length < 12) {
    errors.push('Password must be at least 12 characters long')
  } else {
    score++ // +1 for meeting minimum length
    if (password.length >= 16) score++ // +1 for exceeding minimum
  }

  // Character variety checks
  const hasLowercase = /[a-z]/.test(password)
  const hasUppercase = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)

  if (!hasLowercase) {
    errors.push('Password must contain at least one lowercase letter')
  } else {
    score++
  }

  if (!hasUppercase) {
    errors.push('Password must contain at least one uppercase letter')
  } else {
    score++
  }

  if (!hasNumber) {
    errors.push('Password must contain at least one number')
  } else {
    score++
  }

  if (hasSpecial) {
    score++ // Special characters are optional but increase score
  }

  // Check against common passwords (case-insensitive)
  if (password && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common. Please choose a more unique password')
    score = Math.max(0, score - 2) // Penalty for common password
  }

  // Check for simple patterns
  if (password) {
    // All same character
    if (/^(.)\1+$/.test(password)) {
      errors.push('Password cannot be all the same character')
      score = 0
    }

    // Sequential numbers
    if (/(?:012|123|234|345|456|567|678|789|890){3,}/.test(password)) {
      errors.push('Password contains too simple a numeric pattern')
      score = Math.max(0, score - 1)
    }

    // Sequential letters
    if (/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz){3,}/i.test(password)) {
      errors.push('Password contains too simple a letter pattern')
      score = Math.max(0, score - 1)
    }

    // Keyboard patterns
    if (/(?:qwerty|asdfgh|zxcvbn|qazwsx|123qwe|qwe123)/i.test(password)) {
      errors.push('Password contains keyboard patterns')
      score = Math.max(0, score - 1)
    }
  }

  // Determine strength based on score
  let strength: 'weak' | 'medium' | 'strong'
  if (score <= 2) {
    strength = 'weak'
  } else if (score <= 4) {
    strength = 'medium'
  } else {
    strength = 'strong'
  }

  return {
    valid: errors.length === 0 && password.length >= 12,
    errors,
    strength,
    score
  }
}

/**
 * Checks if a password has been compromised in known data breaches
 * This is a placeholder - in production, use the HaveIBeenPwned API
 * @param password - The password to check
 * @returns true if the password is compromised
 */
export async function isPasswordCompromised(password: string): Promise<boolean> {
  // TODO: Implement HaveIBeenPwned API check in production
  // For now, just check against our local common passwords list
  return COMMON_PASSWORDS.has(password.toLowerCase())
}

/**
 * Generates a secure random password
 * @param length - Length of the password (default: 16)
 * @returns A secure random password
 */
export function generateSecurePassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const numbers = '0123456789'
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?'

  const all = lowercase + uppercase + numbers + special
  const crypto = require('crypto')

  let password = ''

  // Ensure at least one of each type
  password += lowercase[crypto.randomInt(lowercase.length)]
  password += uppercase[crypto.randomInt(uppercase.length)]
  password += numbers[crypto.randomInt(numbers.length)]
  password += special[crypto.randomInt(special.length)]

  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += all[crypto.randomInt(all.length)]
  }

  // Shuffle the password
  return password.split('').sort(() => crypto.randomInt(3) - 1).join('')
}
