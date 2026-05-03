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
 * Generate an excerpt from markdown content.
 * Strips markdown + Eduskript syntax (callouts, blockquotes, list markers,
 * fenced code, raw HTML, etc.) and truncates at word boundary. Used as the
 * og:description for content pages — must look like clean prose to a crawler.
 */
export function generateExcerpt(content: string, maxLength: number = 160): string {
  // Strip block-level constructs that don't carry sentence content first,
  // then line-level prefixes, then inline syntax. Order matters:
  // fenced code & HTML must go before inline-code stripping (which is greedy
  // on `).
  const plainText = content
    // Fenced code blocks: ```lang ... ```  (incl. our `python editor` etc.)
    .replace(/```[\s\S]*?```/g, '')
    // YAML frontmatter (--- ... ---) at the top of a file
    .replace(/^---\n[\s\S]*?\n---\n?/m, '')
    // Raw HTML tags including custom Eduskript components like
    // <plugin .../>, <question>, <tabs-container>, <youtube>, <muxvideo>...
    .replace(/<[^>]+>/g, '')
    // Callout headers: `> [!success] Lernziele` / `> [!note]-` / `> [!type]+`.
    // Match the whole line so the title text (which is meta, not content)
    // doesn't survive into the excerpt.
    .replace(/^[ \t]*>[ \t]*\[![a-zA-Z]+\][-+]?.*$/gm, '')
    // Continuation lines of blockquotes / callouts: drop leading `>` markers
    // (one or many) and the optional space. Run twice in case of nesting.
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    // Headers: `# `, `## `, …
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    // List markers (- / * / +) and ordered (1.) at line start
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')
    // Horizontal rules
    .replace(/^[ \t]*(?:---+|\*\*\*+)[ \t]*$/gm, '')
    // Images first (before links — image syntax is `![...](...)`, link is `[...](...)`).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Links: keep the visible text only
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Bold / italic / inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Common HTML entities that survived raw-HTML stripping
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace last
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
