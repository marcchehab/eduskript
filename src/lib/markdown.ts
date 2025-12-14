/**
 * Markdown utility functions
 *
 * Note: MDX compilation is now handled by mdx-compiler.ts
 * This file only contains utility functions for text processing.
 */

/**
 * Generate an excerpt from markdown content
 */
export function generateExcerpt(content: string, maxLength: number = 160): string {
  // Remove markdown syntax for excerpt
  const plainText = content
    .replace(/#{1,6}\s+/g, '') // Remove headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italics
    .replace(/`(.*?)`/g, '$1') // Remove inline code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .trim()

  if (plainText.length <= maxLength) {
    return plainText
  }

  const truncated = plainText.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  return truncated.substring(0, lastSpace) + '...'
}

/**
 * Generate a URL-friendly slug from a title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim()
}

/**
 * Reserved slugs that conflict with system routes.
 * These cannot be used for collections, skripts, or user page slugs.
 */
export const RESERVED_SLUGS = [
  'api',
  'auth',
  'dashboard',
  'admin',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'signout',
  'settings',
  'profile',
  'classes',
  'consent',
  'test',
  'health',
  '_next',
  'static',
  'public',
  'favicon',
]

/**
 * Check if a slug is reserved (conflicts with system routes).
 * Returns true if the slug is reserved and should not be used.
 */
export function isReservedSlug(slug: string): boolean {
  const normalized = slug.toLowerCase().trim()
  return RESERVED_SLUGS.includes(normalized)
}

/**
 * Validate markdown content for common syntax errors
 */
export function validateMarkdown(content: string): string[] {
  const errors: string[] = []

  // Check for basic structure
  if (!content.trim()) {
    errors.push('Content cannot be empty')
  }

  // Check for balanced markdown syntax
  const boldMatches = content.match(/\*\*/g)
  if (boldMatches && boldMatches.length % 2 !== 0) {
    errors.push('Unbalanced bold syntax (**)')
  }

  const italicMatches = content.match(/(?<!\*)\*(?!\*)/g)
  if (italicMatches && italicMatches.length % 2 !== 0) {
    errors.push('Unbalanced italic syntax (*)')
  }

  const codeMatches = content.match(/`/g)
  if (codeMatches && codeMatches.length % 2 !== 0) {
    errors.push('Unbalanced inline code syntax (`)')
  }

  return errors
}
