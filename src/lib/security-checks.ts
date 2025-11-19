/**
 * Security Configuration Validation
 *
 * Validates that security-critical environment variables are properly configured
 * before the application starts. Prevents deployment with weak or default secrets.
 */

export interface SecurityCheckResult {
  passed: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates all security-critical configuration
 * @returns Validation result with errors and warnings
 */
export function validateSecurityConfiguration(): SecurityCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check STUDENT_PSEUDONYM_SECRET
  const pseudonymSecret = process.env.STUDENT_PSEUDONYM_SECRET
  if (!pseudonymSecret) {
    errors.push('STUDENT_PSEUDONYM_SECRET is not set')
  } else {
    // Check minimum length (should be at least 32 characters for 256 bits)
    if (pseudonymSecret.length < 32) {
      errors.push(`STUDENT_PSEUDONYM_SECRET is too short (${pseudonymSecret.length} chars, minimum 32 required)`)
    }

    // Check for weak/default values
    const weakSecrets = [
      'change-this-to-a-random-secret-in-production',
      'your-secret-key-here-change-in-production',
      'dev-secret',
      'test-secret',
      'secret',
      'password',
      '12345',
    ]

    const lowerSecret = pseudonymSecret.toLowerCase()
    const foundWeak = weakSecrets.find(weak => lowerSecret.includes(weak.toLowerCase()))
    if (foundWeak) {
      errors.push(`STUDENT_PSEUDONYM_SECRET contains weak/default value: "${foundWeak}"`)
    }

    // Check entropy (basic check for character variety)
    const uniqueChars = new Set(pseudonymSecret).size
    if (uniqueChars < 16) {
      warnings.push(`STUDENT_PSEUDONYM_SECRET has low entropy (only ${uniqueChars} unique characters)`)
    }

    // Check if it looks like a properly generated random string
    const hasNumbers = /[0-9]/.test(pseudonymSecret)
    const hasLetters = /[a-zA-Z]/.test(pseudonymSecret)
    if (!hasNumbers || !hasLetters) {
      warnings.push('STUDENT_PSEUDONYM_SECRET should contain both letters and numbers')
    }
  }

  // Check NEXTAUTH_SECRET
  const nextAuthSecret = process.env.NEXTAUTH_SECRET
  if (!nextAuthSecret) {
    errors.push('NEXTAUTH_SECRET is not set')
  } else if (nextAuthSecret.length < 32) {
    errors.push(`NEXTAUTH_SECRET is too short (${nextAuthSecret.length} chars, minimum 32 required)`)
  } else {
    const weakValues = ['your-secret-key-here', 'change-in-production', 'secret']
    if (weakValues.some(weak => nextAuthSecret.toLowerCase().includes(weak))) {
      errors.push('NEXTAUTH_SECRET contains weak/default value')
    }
  }

  // Check NEXTAUTH_URL in production
  if (process.env.NODE_ENV === 'production') {
    const nextAuthUrl = process.env.NEXTAUTH_URL
    if (!nextAuthUrl) {
      errors.push('NEXTAUTH_URL is not set (required in production)')
    } else if (!nextAuthUrl.startsWith('https://')) {
      errors.push('NEXTAUTH_URL must use HTTPS in production')
    }
  }

  // Check database URL
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    warnings.push('DATABASE_URL is not set')
  } else if (databaseUrl.includes('password') || databaseUrl.includes('123456')) {
    warnings.push('DATABASE_URL may contain a weak password')
  }

  // Email configuration (if using email features)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BREVO_API_KEY) {
      warnings.push('BREVO_API_KEY is not set (email features may not work)')
    }
    if (!process.env.EMAIL_FROM) {
      warnings.push('EMAIL_FROM is not set (email features may not work)')
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validates security configuration and throws if critical errors are found
 * Call this during application startup
 */
export function enforceSecurityConfiguration(): void {
  const result = validateSecurityConfiguration()

  // Always log warnings
  if (result.warnings.length > 0) {
    console.warn('⚠️  SECURITY CONFIGURATION WARNINGS:')
    result.warnings.forEach(warning => console.warn(`  - ${warning}`))
  }

  // In production, fail on errors
  if (result.errors.length > 0) {
    console.error('🔴 SECURITY CONFIGURATION ERRORS:')
    result.errors.forEach(error => console.error(`  - ${error}`))

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Security configuration validation failed. Application cannot start with weak secrets in production.'
      )
    } else {
      console.error('\n⚠️  These errors would prevent startup in production!')
      console.error('   Please fix them before deploying.\n')
    }
  } else {
    console.log('✅ Security configuration validated')
  }
}

/**
 * Generates a cryptographically secure random secret
 * Use this to generate values for STUDENT_PSEUDONYM_SECRET and NEXTAUTH_SECRET
 */
export function generateSecureSecret(length: number = 64): string {
  const crypto = require('crypto')
  return crypto.randomBytes(length).toString('hex')
}
