/**
 * Markdown & Slug Utility Functions
 *
 * Text processing utilities for markdown content and URL-safe slug generation.
 * The full markdown rendering pipeline is in markdown-compiler.ts and the
 * markdown-renderer components.
 *
 * ## Slug System
 *
 * Eduskript uses "slugs" as URL-safe identifiers throughout:
 * - **pageSlug**: User's public page URL (e.g., /john-doe)
 * - **Collection slug**: Collection URL segment
 * - **Skript slug**: Skript URL segment
 *
 * Full URL format: /{pageSlug}/{collectionSlug}/{skriptSlug}/{pageSlug}
 *
 * ## Reserved Slugs
 *
 * Some slugs are reserved because they conflict with system routes.
 * Attempting to create a user, collection, or skript with a reserved
 * slug will be rejected. See RESERVED_SLUGS for the full list.
 *
 * @see src/lib/markdown-compiler.ts for full markdown compilation
 * @see src/components/markdown/markdown-renderer.server.tsx for server rendering
 * @see src/components/markdown/markdown-renderer.client.tsx for client rendering
 */

/**
 * Generate an excerpt from markdown content for use as og:description.
 *
 * Strategy: instead of trying to peel markdown syntax off every line, just
 * skip lines that *start* with one. Eduskript pages reliably open with a
 * heading and a `> [!success] Lernziele` callout — those are exactly the
 * "wrong" lines for a search/social preview, and they all start with `#`
 * or `>`. Filtering on the first character of each line lets us reach the
 * first real paragraph automatically. Inline cleanup (links, bold, …) is
 * still applied to the prose lines we keep.
 */
export function generateExcerpt(content: string, maxLength: number = 160): string {
  // Block-level constructs that span multiple lines need to go first so the
  // line filter below sees a clean stream.
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '')        // fenced code blocks (incl. `python editor`)
    .replace(/^---\n[\s\S]*?\n---\n?/m, '') // YAML frontmatter
    .replace(/<[^>]+>/g, '')                // raw HTML + custom components

  // A line is "prose" if its first non-whitespace character isn't a
  // structural-markdown marker. This drops headings, callouts/blockquotes,
  // list items, horizontal rules, and bare table separators. Comparing with
  // a Set is cheaper than running a regex per line on long pages.
  const STRUCTURAL_FIRST_CHARS = new Set(['#', '>', '-', '*', '+', '|', '='])
  const proseLines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false
      if (STRUCTURAL_FIRST_CHARS.has(line[0])) return false
      // Ordered list: `1. text`, `12. text`. A leading digit alone is fine
      // (years, counts) — only filter when followed by a dot+space.
      if (/^\d+\.[ \t]/.test(line)) return false
      return true
    })

  const plainText = proseLines
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // images first (before links)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → keep text
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // bold
    .replace(/\*([^*]+)\*/g, '$1')          // italic
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  if (plainText.length <= maxLength) {
    return plainText
  }

  const truncated = plainText.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  return truncated.substring(0, lastSpace) + '…'
}

/**
 * Generate a URL-friendly slug from a title.
 *
 * Transforms: "My Collection Title!" → "my-collection-title"
 *
 * Note: This function does NOT check for reserved slugs or uniqueness.
 * Callers should use isReservedSlug() and check database uniqueness.
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
 *
 * If you add a new top-level route to the app, add it here to prevent
 * users from creating content that would shadow it.
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
  'embed',
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
