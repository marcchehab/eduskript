/**
 * Domain detection utilities for teacher vs student account type determination
 */

/**
 * Checks if the current request is from the main domain (eduskript.org)
 * Main domain = teacher signups
 * Subdomains = student signups
 */
export function isMainDomain(hostname: string): boolean {
  // Remove port if present
  const cleanHostname = hostname.split(':')[0]

  // Check if it's exactly eduskript.org (not a subdomain)
  // Also handle localhost and IP addresses for development
  return (
    cleanHostname === 'eduskript.org' ||
    cleanHostname === 'localhost' ||
    cleanHostname === '127.0.0.1' ||
    // Match any IP address (IPv4)
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHostname)
  )
}

/**
 * Checks if the current request is from a subdomain
 * Subdomains indicate student signups
 */
export function isSubdomain(hostname: string): boolean {
  const cleanHostname = hostname.split(':')[0]

  // Check if it's a subdomain of eduskript.org
  // Examples: teacher1.eduskript.org, math.eduskript.org
  return (
    cleanHostname.endsWith('.eduskript.org') &&
    cleanHostname !== 'eduskript.org'
  )
}

/**
 * Determines the account type based on the domain
 * Main domain -> teacher
 * Subdomain -> student
 */
export function getAccountTypeFromDomain(hostname: string): 'teacher' | 'student' {
  return isMainDomain(hostname) ? 'teacher' : 'student'
}

/**
 * Gets the account type from the window location (client-side only)
 * Checks both hostname (subdomain) and pathname (path-based routing)
 */
export function getAccountTypeFromWindow(): 'teacher' | 'student' {
  if (typeof window === 'undefined') {
    throw new Error('getAccountTypeFromWindow can only be called on the client side')
  }

  const hostname = window.location.hostname
  const pathname = window.location.pathname

  // Check if we're on a subdomain first (e.g., eduadmin.localhost:3000)
  if (isSubdomain(hostname)) {
    return 'student'
  }

  // Check if we're on the main domain but accessing a teacher's path
  // (e.g., localhost:3000/eduadmin/...)
  if (isMainDomain(hostname)) {
    // If the path starts with a teacher subdomain (not /auth, /dashboard, etc.)
    // then we're viewing a teacher's public page, so treat as student signup
    const pathParts = pathname.split('/').filter(Boolean)
    const firstPathSegment = pathParts[0]

    // Reserved paths that are NOT teacher subdomains
    const reservedPaths = ['auth', 'dashboard', 'api', 'consent', 'privacy', 'terms']

    if (firstPathSegment && !reservedPaths.includes(firstPathSegment)) {
      // This is a teacher's public page (e.g., /eduadmin/...)
      return 'student'
    }

    // Otherwise, we're on the main domain homepage or reserved paths
    return 'teacher'
  }

  // Default: if not main domain and not a recognized subdomain, treat as student
  return 'student'
}
