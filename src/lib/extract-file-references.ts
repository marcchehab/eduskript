/**
 * Extracts all filenames referenced in markdown content, including derived files
 * (excalidraw light/dark SVGs, schema images for databases).
 *
 * No file-page mapping table exists — we use regex extraction from markdown.
 * This is pragmatic given the well-structured markdown patterns used in Eduskript.
 */

/** Skip absolute URLs, anchors, and mailto links */
function isLocalRef(ref: string): boolean {
  return (
    !ref.startsWith('http://') &&
    !ref.startsWith('https://') &&
    !ref.startsWith('/') &&
    !ref.startsWith('#') &&
    !ref.startsWith('mailto:')
  )
}

const VIDEO_EXTENSIONS = /\.(mp4|mov)$/i

export function extractReferencedFilenames(content: string): string[] {
  const filenames = new Set<string>()

  // 1. Image/excalidraw refs: ![...](filename)
  // Matches both images and excalidraw files
  const imageRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g
  for (const match of content.matchAll(imageRegex)) {
    const ref = match[1]
    if (!isLocalRef(ref)) continue
    if (VIDEO_EXTENSIONS.test(ref)) continue // videos live in the Video table, handled separately
    filenames.add(ref)

    // Excalidraw: also add light/dark SVG variants
    if (ref.endsWith('.excalidraw')) {
      filenames.add(`${ref}.light.svg`)
      filenames.add(`${ref}.dark.svg`)
    }
  }

  // 2. SQL database refs: db="filename.db"
  const dbRegex = /db="([^"]+)"/g
  for (const match of content.matchAll(dbRegex)) {
    const dbFile = match[1]
    filenames.add(dbFile)

    // Default schema pattern: {basename}-schema.excalidraw.{light|dark}.svg
    const basename = dbFile.replace(/\.(db|sqlite)$/i, '')
    filenames.add(`${basename}-schema.excalidraw.light.svg`)
    filenames.add(`${basename}-schema.excalidraw.dark.svg`)
  }

  // 3. Explicit schema-image refs: schema-image="name"
  const schemaRegex = /schema-image="([^"]+)"/g
  for (const match of content.matchAll(schemaRegex)) {
    const name = match[1]
    filenames.add(`${name}.excalidraw.light.svg`)
    filenames.add(`${name}.excalidraw.dark.svg`)
  }

  // 4. File link refs: [text](filename) — non-image links
  // The image regex above uses `!` prefix; this captures plain links
  const linkRegex = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g
  for (const match of content.matchAll(linkRegex)) {
    const ref = match[1]
    if (!isLocalRef(ref)) continue
    filenames.add(ref)
  }

  return [...filenames]
}

/**
 * Extracts video filenames (.mp4, .mov) referenced in markdown content.
 * Videos are stored in the Video table (not File), so they're handled separately
 * from extractReferencedFilenames.
 */
export function extractReferencedVideoFilenames(content: string): string[] {
  const filenames = new Set<string>()

  const imageRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g
  for (const match of content.matchAll(imageRegex)) {
    const ref = match[1]
    if (!isLocalRef(ref)) continue
    if (!VIDEO_EXTENSIONS.test(ref)) continue
    filenames.add(ref)
  }

  return [...filenames]
}
