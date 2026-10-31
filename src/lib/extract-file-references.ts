/**
 * Extracts all filenames referenced in markdown content, including derived files
 * (excalidraw light/dark SVGs, schema images for databases).
 *
 * No file-page mapping table exists — we use regex extraction from markdown.
 * This is pragmatic given the well-structured markdown patterns used in Eduskript.
 *
 * A reference contributes every name it can mean (fileRefCandidates). Compare
 * the result with matchByRefs (file-refs.ts), not with exact string equality:
 * that is what covers NFC/NFD and U+202F, the way rendering does.
 */

import { solutionFilename } from '@/lib/ai/feedback-context'
import { possibleFileRefs, repairFileRefs } from '@/lib/file-ref-repair'
import { FILE_DESTINATION_SOURCE, fileRefCandidates, parseFileDestination } from '@/lib/file-refs'

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
const IMAGE_REF = new RegExp(String.raw`!\[(?:\\.|[^\]\\])*\]\((${FILE_DESTINATION_SOURCE})\)`, 'g')
const LINK_REF = new RegExp(String.raw`(?<!!)\[(?:\\.|[^\]\\])*\]\((${FILE_DESTINATION_SOURCE})\)`, 'g')

export function extractReferencedFilenames(source: string): string[] {
  const filenames = new Set<string>()
  const content = repairFileRefs(source)

  // 1. Image/excalidraw refs: ![...](filename)
  // Matches both images and excalidraw files
  for (const match of content.matchAll(IMAGE_REF)) {
    const { ref } = parseFileDestination(match[1])
    if (!ref || !isLocalRef(ref)) continue
    if (VIDEO_EXTENSIONS.test(ref)) continue // videos live in the Video table, handled separately

    for (const name of fileRefCandidates(ref)) {
      filenames.add(name)

      // Excalidraw: also add light/dark SVG variants
      if (name.endsWith('.excalidraw')) {
        filenames.add(`${name}.light.svg`)
        filenames.add(`${name}.dark.svg`)
      }
    }
  }

  // Legacy names with a stray `)`: every reading of the destination, because
  // this has no file list. matchByRefs drops the readings that match nothing.
  for (const ref of possibleFileRefs(source)) {
    if (!isLocalRef(ref) || VIDEO_EXTENSIONS.test(ref)) continue
    for (const name of fileRefCandidates(ref)) {
      filenames.add(name)
      if (name.endsWith('.excalidraw')) {
        filenames.add(`${name}.light.svg`)
        filenames.add(`${name}.dark.svg`)
      }
    }
  }

  // 2. SQL database refs: db="filename.db"
  const dbRegex = /db="([^"]+)"/g
  for (const match of content.matchAll(dbRegex)) {
    for (const dbFile of fileRefCandidates(match[1])) {
      filenames.add(dbFile)

      // Default schema pattern: {basename}-schema.excalidraw.{light|dark}.svg
      const basename = dbFile.replace(/\.(db|sqlite)$/i, '')
      filenames.add(`${basename}-schema.excalidraw.light.svg`)
      filenames.add(`${basename}-schema.excalidraw.dark.svg`)
    }
  }

  // 3. Explicit schema-image refs: schema-image="name"
  const schemaRegex = /schema-image="([^"]+)"/g
  for (const match of content.matchAll(schemaRegex)) {
    const name = match[1]
    filenames.add(`${name}.excalidraw.light.svg`)
    filenames.add(`${name}.excalidraw.dark.svg`)
  }

  // 4. AI feedback reference solutions: <ai-feedback solution="name">
  // Only the file the loader reads (light SVG for excalidraw) — the solution
  // is never rendered, so the dark variant isn't needed.
  const solutionRegex = /<ai-feedback\b[^>]*?\bsolution="([^"]+)"/gi
  for (const match of content.matchAll(solutionRegex)) {
    filenames.add(solutionFilename(match[1]))
  }

  // 5. File link refs: [text](filename) — non-image links
  // The image regex above uses `!` prefix; this captures plain links
  for (const match of content.matchAll(LINK_REF)) {
    const { ref } = parseFileDestination(match[1])
    if (!ref || !isLocalRef(ref)) continue
    for (const name of fileRefCandidates(ref)) filenames.add(name)
  }

  // 6. Tag refs: <pdf src="…">, <audio src="…">, <source src="…">
  for (const match of content.matchAll(/<(?:pdf|audio|source)\b[^>]*?\bsrc="([^"]+)"/gi)) {
    if (!isLocalRef(match[1])) continue
    for (const name of fileRefCandidates(match[1])) filenames.add(name)
  }

  return [...filenames]
}

/**
 * Extracts video filenames (.mp4, .mov) referenced in markdown content.
 * Videos are stored in the Video table (not File), so they're handled separately
 * from extractReferencedFilenames.
 */
export function extractReferencedVideoFilenames(source: string): string[] {
  const filenames = new Set<string>()
  const content = repairFileRefs(source)

  for (const match of content.matchAll(IMAGE_REF)) {
    const { ref } = parseFileDestination(match[1])
    if (!ref || !isLocalRef(ref)) continue
    if (!VIDEO_EXTENSIONS.test(ref)) continue
    for (const name of fileRefCandidates(ref)) filenames.add(name)
  }

  for (const ref of possibleFileRefs(source)) {
    if (!isLocalRef(ref) || !VIDEO_EXTENSIONS.test(ref)) continue
    for (const name of fileRefCandidates(ref)) filenames.add(name)
  }

  return [...filenames]
}
