/**
 * Pure helpers shared between the client-side importer
 * (skript-import-client.ts, runs in the browser) and the server actions
 * (import-actions.ts). No 'use client'/'use server' directive and no
 * prisma/fs/S3 imports, so both sides can import it directly.
 */

export interface ExportManifest {
  version: number
  exportedAt: string
  collections: {
    title: string
    description: string | null
    skripts: string[] // skript slugs in this collection
  }[]
  skripts: {
    [slug: string]: {
      title: string
      description: string | null
      pages: string[]
    }
  }
}

export interface ImportError {
  type: 'error' | 'warning'
  location: string
  message: string
}

export const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'svg': 'image/svg+xml',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'pdf': 'application/pdf',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'json': 'application/json',
  'excalidraw': 'application/json',
  'db': 'application/x-sqlite3',
  'sqlite': 'application/x-sqlite3'
}

export function attachmentContentType(finalName: string): string {
  const ext = finalName.endsWith('.excalidraw')
    ? 'excalidraw'
    : (finalName.split('.').pop() || 'bin')
  return ATTACHMENT_CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

export function validateMarkdownSyntax(content: string, location: string): ImportError[] {
  const errors: ImportError[] = []

  // Check for unclosed code blocks
  const codeBlockMatches = content.match(/```/g) || []
  if (codeBlockMatches.length % 2 !== 0) {
    errors.push({
      type: 'error',
      location,
      message: 'Unclosed code block (odd number of ```)'
    })
  }

  // Check for broken image/link syntax
  const brokenImageLinks = content.match(/!\[[^\]]*\]\([^)]*$/gm)
  if (brokenImageLinks) {
    errors.push({
      type: 'error',
      location,
      message: 'Broken image/link syntax (unclosed parenthesis)'
    })
  }

  // Check for old wiki-link syntax that wasn't converted
  const wikiLinks = content.match(/\[\[[^\]]+\]\]/g)
  if (wikiLinks) {
    errors.push({
      type: 'warning',
      location,
      message: `Found ${wikiLinks.length} wiki-links that may need conversion: ${wikiLinks.slice(0, 3).join(', ')}${wikiLinks.length > 3 ? '...' : ''}`
    })
  }

  // Check for unclosed callouts
  const calloutStart = content.match(/>\s*\[![\w-]+\]/g) || []
  if (calloutStart.length > 10) {
    errors.push({
      type: 'warning',
      location,
      message: `Found ${calloutStart.length} callouts - verify they render correctly`
    })
  }

  // Check for broken table syntax
  const tableRows = content.match(/^\|.*\|$/gm) || []
  if (tableRows.length > 0) {
    const separatorRows = content.match(/^\|[-:| ]+\|$/gm) || []
    if (separatorRows.length === 0 && tableRows.length > 1) {
      errors.push({
        type: 'warning',
        location,
        message: 'Table may be missing separator row (|---|---|)'
      })
    }
  }

  // Check for potential YAML frontmatter issues
  if (content.startsWith('---')) {
    const frontmatterEnd = content.indexOf('---', 4)
    if (frontmatterEnd === -1) {
      errors.push({
        type: 'error',
        location,
        message: 'Unclosed YAML frontmatter'
      })
    }
  }

  return errors
}

export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const [, frontmatterStr, body] = match
  const frontmatter: Record<string, string> = {}

  frontmatterStr.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value = line.slice(colonIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      frontmatter[key] = value
    }
  })

  return { frontmatter, body }
}
