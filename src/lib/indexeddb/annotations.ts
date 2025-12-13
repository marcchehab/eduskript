import Dexie, { Table } from 'dexie'

// Individual stroke/path data structure
export interface StrokeData {
  id: string               // Unique identifier for per-stroke animations
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string        // Which section this stroke belongs to
  sectionOffsetY: number   // Y-offset of section when drawn
}

// Heading position tracking
export interface HeadingPosition {
  sectionId: string
  offsetY: number
  headingText: string
}

// Old format (for migration)
export interface SectionAnnotation {
  sectionId: string
  headingText: string
  canvasData: string // JSON stringified canvas data
  createdAt: number
  updatedAt: number
}

// New single-canvas page annotation
export interface PageAnnotation {
  pageId: string // Primary key
  pageVersion: string // Content hash for version tracking
  canvasData: string // JSON stringified StrokeData[] for entire page
  headingOffsets: Record<string, number> // sectionId → Y position
  createdAt: number
  updatedAt: number
}

// Old format (for migration)
export interface LegacyPageAnnotation {
  pageId: string
  pageVersion: string
  sections: SectionAnnotation[]
  createdAt: number
  updatedAt: number
}

// Dexie database class
class AnnotationDatabase extends Dexie {
  annotations!: Table<PageAnnotation, string>

  constructor() {
    super('EduskriptAnnotations')

    // Version 1: Original multi-canvas format
    this.version(1).stores({
      annotations: 'pageId, pageVersion, updatedAt'
    })

    // Version 2: Single canvas format with migration
    this.version(2).stores({
      annotations: 'pageId, pageVersion, updatedAt'
    }).upgrade(async (tx) => {
      // Migrate old multi-section format to new single-canvas format
      const annotations = await tx.table('annotations').toArray()

      for (const annotation of annotations) {
        const legacy = annotation as unknown as LegacyPageAnnotation

        if ('sections' in legacy && legacy.sections) {
          // Migrate from old format
          const migratedAnnotation = await migrateToSingleCanvas(legacy)
          await tx.table('annotations').put(migratedAnnotation)
        }
      }
    })
  }
}

// Singleton instance
export const annotationDb = new AnnotationDatabase()

/**
 * Migrate legacy multi-section format to single-canvas format
 */
async function migrateToSingleCanvas(legacy: LegacyPageAnnotation): Promise<PageAnnotation> {
  const allStrokes: StrokeData[] = []
  const headingOffsets: Record<string, number> = {}

  // For each section, parse canvas data and add sectionId
  for (const section of legacy.sections) {
    try {
      const sectionStrokes = JSON.parse(section.canvasData) as Array<{
        points: Array<{ x: number; y: number; pressure: number }>
        mode: 'draw' | 'erase'
        color: string
        width: number
      }>

      // Assume section offset is 0 (we don't have historical data)
      // These will be recalculated on first load
      headingOffsets[section.sectionId] = 0

      // Add section ID and generate stable IDs for each stroke
      const migratedStrokes = sectionStrokes.map((stroke) => {
        const points = stroke.points || []
        const first = points[0]
        const last = points[points.length - 1]
        const parts = [
          first ? `${first.x.toFixed(1)},${first.y.toFixed(1)}` : '0,0',
          last ? `${last.x.toFixed(1)},${last.y.toFixed(1)}` : '0,0',
          points.length,
          stroke.color || 'black',
          stroke.width || 2,
          section.sectionId
        ]
        return {
          ...stroke,
          id: `stroke-${parts.join('-')}`,
          sectionId: section.sectionId,
          sectionOffsetY: 0 // Will be recalculated on load
        }
      })

      allStrokes.push(...migratedStrokes)
    } catch (error) {
      console.error(`Error migrating section ${section.sectionId}:`, error)
    }
  }

  return {
    pageId: legacy.pageId,
    pageVersion: legacy.pageVersion,
    canvasData: JSON.stringify(allStrokes),
    headingOffsets,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt
  }
}

// Helper functions for annotation management

/**
 * Get annotations for a specific page
 */
export async function getPageAnnotations(pageId: string): Promise<PageAnnotation | undefined> {
  try {
    return await annotationDb.annotations.get(pageId)
  } catch (error) {
    console.error('Error getting page annotations:', error)
    return undefined
  }
}

/**
 * Save or update page annotations with single canvas data
 */
export async function savePageAnnotations(
  pageId: string,
  pageVersion: string,
  canvasData: string,
  headingOffsets: Record<string, number>
): Promise<void> {
  try {
    const now = Date.now()
    const existing = await annotationDb.annotations.get(pageId)

    if (existing) {
      await annotationDb.annotations.update(pageId, {
        pageVersion,
        canvasData,
        headingOffsets,
        updatedAt: now
      })
    } else {
      await annotationDb.annotations.add({
        pageId,
        pageVersion,
        canvasData,
        headingOffsets,
        createdAt: now,
        updatedAt: now
      })
    }
  } catch (error) {
    console.error('Error saving page annotations:', error)
    throw error
  }
}

/**
 * Clear all annotations for a page
 */
export async function clearPageAnnotations(pageId: string): Promise<void> {
  try {
    await annotationDb.annotations.delete(pageId)
  } catch (error) {
    console.error('Error clearing page annotations:', error)
    throw error
  }
}

/**
 * Check if page version has changed
 */
export async function checkVersionMismatch(pageId: string, currentVersion: string): Promise<boolean> {
  try {
    const existing = await annotationDb.annotations.get(pageId)
    if (!existing) return false
    return existing.pageVersion !== currentVersion
  } catch (error) {
    console.error('Error checking version mismatch:', error)
    return false
  }
}

/**
 * Export all annotations as JSON
 */
export async function exportAnnotations(): Promise<string> {
  try {
    const allAnnotations = await annotationDb.annotations.toArray()
    return JSON.stringify(allAnnotations, null, 2)
  } catch (error) {
    console.error('Error exporting annotations:', error)
    throw error
  }
}

/**
 * Import annotations from JSON
 */
export async function importAnnotations(jsonData: string): Promise<void> {
  try {
    const annotations = JSON.parse(jsonData) as PageAnnotation[]
    await annotationDb.annotations.bulkPut(annotations)
  } catch (error) {
    console.error('Error importing annotations:', error)
    throw error
  }
}

/**
 * Generate content hash for versioning
 */
export async function generateContentHash(content: string): Promise<string> {
  if (typeof window === 'undefined') {
    // Server-side: use simple hash
    return Buffer.from(content).toString('base64').slice(0, 8)
  }

  // Client-side: use crypto.subtle for proper hash
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 16) // First 16 chars of SHA-256
}
