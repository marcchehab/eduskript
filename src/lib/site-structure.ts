/**
 * Site Structure Utilities
 *
 * Provides a single source of truth for transforming collection data
 * into the SiteStructure format used by PublicSiteLayout sidebar.
 *
 * This ensures consistent filtering and transformation across all routes:
 * - Homepage
 * - Collection preview
 * - Skript frontpage
 * - Page content
 */

// Interface matching PublicSiteLayout's SiteStructure prop
export interface SiteStructure {
  id: string
  title: string
  slug: string
  accentColor?: string | null // Hex color for letter markers
  skripts: SiteStructureSkript[]
}

export interface SiteStructureSkript {
  id: string
  title: string
  slug: string
  order?: number // Position within collection (0-indexed) for letter markers
  hasFrontpage?: boolean // Whether the skript has a frontpage (for navigation behavior)
  pages: SiteStructurePage[]
}

export interface SiteStructurePage {
  id: string
  title: string
  slug: string
  // Only 'exam' has sidebar consequences (hideSidebar); other types pass through unused.
  pageType?: string | null
}

// Input type for raw collection data from Prisma queries
// Flexible to handle various query shapes
interface RawPage {
  id: string
  title: string
  slug: string
  isPublished?: boolean
  isUnlisted?: boolean
  order?: number
  pageType?: string | null
}

interface RawSkript {
  id: string
  title: string
  slug: string
  isPublished?: boolean
  isUnlisted?: boolean
  frontPage?: { id: string } | null // Optional frontpage relation
  pages: RawPage[]
}

interface RawCollectionSkript {
  order?: number | null
  skript: RawSkript
}

interface RawCollection {
  id: string
  title: string
  slug: string
  accentColor?: string | null
  collectionSkripts: RawCollectionSkript[]
}

interface BuildOptions {
  /**
   * When true (default), filters out unpublished collections, skripts, and pages.
   * Set to false for preview mode where authors can see unpublished content.
   */
  onlyPublished?: boolean
}

/**
 * Transform raw collection data into SiteStructure format.
 *
 * Features:
 * - Filters to only published content when onlyPublished=true (default)
 * - Sorts skripts by order field, then by index
 * - Sorts pages by order field
 * - Removes empty collections (no visible skripts) and skripts (no visible pages)
 * - Calculates skript order for letter marker display (A, B, C, etc.)
 *
 * @param collections - Raw collection data from Prisma queries
 * @param options - Transform options
 * @returns SiteStructure array suitable for PublicSiteLayout
 */
export function buildSiteStructure(
  collections: RawCollection[],
  options: BuildOptions = {}
): SiteStructure[] {
  const { onlyPublished = true } = options

  return collections
    // Collections are always shown (no publish status — purely organizational)
    .map(col => ({
      id: col.id,
      title: col.title,
      slug: col.slug,
      accentColor: col.accentColor,
      skripts: col.collectionSkripts
        // Filter unpublished skripts
        .filter(cs => !onlyPublished || (cs.skript.isPublished !== false && !cs.skript.isUnlisted))
        // Sort by order field
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((cs, index) => ({
          id: cs.skript.id,
          title: cs.skript.title,
          slug: cs.skript.slug,
          // Use index after sorting - this is the position in the collection for letter markers (A, B, C...)
          order: index,
          hasFrontpage: Boolean(cs.skript.frontPage),
          pages: cs.skript.pages
            // Filter unpublished pages
            .filter(p => !onlyPublished || (p.isPublished !== false && !p.isUnlisted))
            // Sort by order field
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              pageType: p.pageType ?? null
            }))
        }))
        // Remove skripts with no visible pages
        .filter(s => s.pages.length > 0)
    }))
    // Remove collections with no visible skripts
    .filter(c => c.skripts.length > 0)
}

/**
 * Helper to build a single-collection structure for contextual navigation.
 * Used when viewing a specific page - shows only that page's collection.
 *
 * @param collection - Single collection with its skripts and pages
 * @param skriptSlug - Optional: only include this skript (for focused view)
 * @param options - Transform options
 */
export function buildContextualStructure(
  collection: RawCollection,
  skriptSlug?: string,
  options: BuildOptions = {}
): SiteStructure[] {
  // If skriptSlug provided, filter to just that skript
  const filteredCollection = skriptSlug
    ? {
        ...collection,
        collectionSkripts: collection.collectionSkripts.filter(
          cs => cs.skript.slug === skriptSlug
        )
      }
    : collection

  return buildSiteStructure([filteredCollection], options)
}
