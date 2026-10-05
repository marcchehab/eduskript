/**
 * Anonymous skript import: job lifecycle (create → process → claim → expire).
 *
 * Flow: POST /api/script-import (upload, limits, proof of work) creates a
 * ScriptImport row in status "processing" and runs processImport() via
 * next/server after(); the preview page /import/<token> polls until "ready".
 * After signup the dashboard calls POST /api/script-import/claim, which moves
 * pages + images into the new account (claimImport). Unclaimed rows are
 * deleted by the daily cron (deleteExpiredImports).
 *
 * Related: convert-docx.ts (pandoc), cleanup.ts (Claude), split.ts (pages),
 * limits.ts, pow.ts. Model: ScriptImport in prisma/schema.prisma.
 */
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { saveFile } from '@/lib/file-storage'
import { createSkriptForUser } from '@/lib/services/skripts'
import { createPageForUser, ConflictError } from '@/lib/services/pages'
import { convertDocx } from './convert-docx'
import { convertPdf } from './convert-pdf'
import { convertText } from './convert-text'
import { officeToDocx, type OfficeExtension } from './libreoffice'
import { cleanupMarkdown } from './cleanup'
import { pageSlug, splitIntoPages, type ImportPage } from './split'
import { ImportError, MAX_MARKDOWN_CHARS, MAX_WORD_PAGES, RETENTION_DAYS } from './limits'

export const IMPORT_COOKIE = 'eduskript_script_import'

/** Shown in the preview so the teacher knows what to check. Stored as ScriptImport.warnings. */
export interface ImportWarnings {
  /** Where the content came from; the preview explains PDF limits. Absent on imports before 2026-10. */
  source?: ImportInput['kind']
  /** Pasted text: detected format. */
  textFormat?: 'latex' | 'html' | 'markdown'
  /** PDF: pages kept as a full-page picture because reading them failed. */
  pagesAsImages?: number
  /** PDF: figures cut out of the pages. */
  pdfFigures?: number
  /** .doc/.odt/.rtf converted to .docx by LibreOffice first. */
  convertedFrom?: OfficeExtension
  /** Legacy (Equation Editor/MathType) formulas read from their picture by the model. */
  formulasTranscribed: number
  /** Legacy formulas the model couldn't read; kept as pictures. */
  formulasAsImages: number
  /** Pictures in a format we can't display (EMF), replaced by a note. */
  imagesDropped: number
  /** Drawings built from Word shapes/label boxes, replaced by a note (convert-docx.ts inlineTextboxes). */
  drawingsDropped?: number
  /** Word shape drawings redrawn as pictures (drawing-render.ts); worth a look. */
  drawingsRendered?: number
  /** Chunks where the model output was rejected (content loss guard) and raw conversion kept. */
  chunksUncleaned: number
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createImport(opts: { fileName: string; ipHash: string; powSalt: string }) {
  return prisma.scriptImport.create({
    data: {
      token: newToken(),
      fileName: opts.fileName.slice(0, 200),
      ipHash: opts.ipHash,
      powSalt: opts.powSalt,
      expiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
    select: { id: true, token: true },
  })
}


/** What was uploaded: a Word file, a PDF, or pasted text (+ the clipboard's HTML flavour). */
export type ImportInput =
  | { kind: 'docx'; buf: Buffer }
  | { kind: 'office'; buf: Buffer; ext: OfficeExtension }
  | { kind: 'pdf'; buf: Buffer }
  | { kind: 'text'; text: string; html?: string | null }

/** Source-specific conversion → Markdown + assets; all sources then share split/save below. */
async function convertSource(input: ImportInput): Promise<Awaited<ReturnType<typeof convertDocxSource>>> {
  if (input.kind === 'office') {
    // .doc/.odt/.rtf: LibreOffice → .docx, then the Word path (libreoffice.ts).
    let docx: Buffer
    try {
      docx = await officeToDocx(input.buf, input.ext)
    } catch (err) {
      console.error('[script-import] libreoffice conversion failed:', err)
      throw new ImportError(`The .${input.ext} file could not be opened. Please save it as .docx and try again.`)
    }
    const converted = await convertDocxSource(docx)
    return { ...converted, warnings: { ...converted.warnings, convertedFrom: input.ext } }
  }
  if (input.kind === 'docx') return convertDocxSource(input.buf)
  return convertOtherSource(input)
}

async function convertDocxSource(buf: Buffer) {
  const converted = await convertDocx(buf)
  if (converted.pageCount && converted.pageCount > MAX_WORD_PAGES) {
    throw new ImportError(`The document has ${converted.pageCount} pages; the limit is ${MAX_WORD_PAGES}.`)
  }
  checkSize(converted.markdown)
  const formulaImages = new Map(
    converted.assets.filter((a) => /^(formula|symbol)-/.test(a.name)).map((a) => [a.name, a.data])
  )
  const cleaned = await cleanupMarkdown(converted.markdown, formulaImages, 'docx')
  return {
    raw: converted.markdown,
    markdown: cleaned.markdown,
    assets: converted.assets,
    costUsd: cleaned.costUsd,
    warnings: {
      imagesDropped: converted.unsupportedImages,
      drawingsDropped: converted.drawings,
      drawingsRendered: converted.drawingsRendered,
      chunksUncleaned: cleaned.fallbacks,
    } as ImportWarningsPart,
  }
}

type ImportWarningsPart = Partial<ImportWarnings> & Pick<ImportWarnings, 'imagesDropped' | 'chunksUncleaned'>

async function convertOtherSource(input: Extract<ImportInput, { kind: 'text' | 'pdf' }>) {
  if (input.kind === 'text') {
    const converted = await convertText(input.text, input.html)
    checkSize(converted.markdown)
    const cleaned = await cleanupMarkdown(converted.markdown, new Map(), 'text')
    return {
      raw: converted.markdown,
      markdown: cleaned.markdown,
      assets: converted.assets,
      costUsd: cleaned.costUsd,
      warnings: { imagesDropped: converted.unsupportedImages, chunksUncleaned: cleaned.fallbacks, textFormat: converted.format } as ImportWarningsPart,
    }
  }
  // PDF: the model reads the pages and already applies the cleanup rules (convert-pdf.ts).
  const converted = await convertPdf(input.buf, MAX_WORD_PAGES)
  checkSize(converted.markdown)
  return {
    raw: converted.markdown,
    markdown: converted.markdown,
    assets: converted.assets,
    costUsd: converted.costUsd,
    warnings: { imagesDropped: 0, chunksUncleaned: 0, pagesAsImages: converted.failedPages, pdfFigures: converted.figures } as ImportWarningsPart,
  }
}

function checkSize(markdown: string) {
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    throw new ImportError(`The document is too long (limit about ${MAX_WORD_PAGES} pages).`)
  }
  if (!markdown.trim()) throw new ImportError('The document contains no text.')
}

const FAILURE: Record<ImportInput['kind'], string> = {
  docx: 'The document could not be converted. Is it a valid Word (.docx) file?',
  office: 'The document could not be converted. Please save it as .docx and try again.',
  pdf: 'The PDF could not be converted.',
  text: 'The text could not be converted.',
}

export async function processImport(id: string, input: ImportInput, fileName: string): Promise<void> {
  const started = Date.now()
  try {
    const converted = await convertSource(input)
    const fallbackTitle = fileName.replace(/\.(docx|pdf|doc|odt|rtf)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported skript'
    // Formula/symbol pictures the model didn't transcribe (or all, if cleanup
    // failed) stay images; size them to the text line instead of full width.
    const markdown = converted.markdown.replace(
      /!\[[^\]]*\]\(((?:formula|symbol)-\d+\.png)\)/g,
      '<img src="$1" alt="" inline="true" style="height: 1.4em; vertical-align: middle" />'
    )
    const { title, pages } = splitIntoPages(markdown, fallbackTitle)
    // Formula images the model transcribed are no longer referenced; don't keep them.
    const allContent = pages.map((p) => p.content).join('\n')
    const assets = converted.assets.filter((a) => allContent.includes(`](${a.name})`) || allContent.includes(`"${a.name}"`))
    const untranscribed = assets.filter((a) => a.name.startsWith('formula-')).length // still referenced as <img>
    const formulasInDoc = new Set(converted.raw.match(/formula-\d+\.png/g) ?? []).size
    const warnings: ImportWarnings = {
      source: input.kind,
      formulasTranscribed: Math.max(formulasInDoc - untranscribed, 0),
      formulasAsImages: untranscribed,
      ...converted.warnings,
    }

    await prisma.$transaction([
      prisma.scriptImportAsset.createMany({
        data: assets.map((a) => ({ importId: id, name: a.name, contentType: a.contentType, data: new Uint8Array(a.data) })),
      }),
      prisma.scriptImport.update({
        where: { id },
        data: {
          status: 'ready',
          title: title.slice(0, 200),
          pages: pages as unknown as Prisma.InputJsonValue,
          warnings: warnings as unknown as Prisma.InputJsonValue,
          costUsd: converted.costUsd,
        },
      }),
    ])
    console.log(
      `[script-import] ${id} ready in ${Date.now() - started} ms: ${pages.length} pages, ${assets.length} images, ` +
        `$${converted.costUsd.toFixed(3)}, ${JSON.stringify(warnings)}`
    )
  } catch (err) {
    console.error(`[script-import] ${id} failed:`, err)
    await prisma.scriptImport
      .update({
        where: { id },
        data: {
          status: 'failed',
          error: err instanceof ImportError ? err.message : FAILURE[input.kind],
        },
      })
      .catch(() => {})
  }
}

export async function getImportByToken(token: string) {
  if (!token || token.length > 64) return null
  const row = await prisma.scriptImport.findUnique({
    where: { token },
    select: {
      id: true, token: true, status: true, title: true, pages: true, error: true,
      fileName: true, expiresAt: true, claimedAt: true, claimedSkriptId: true, createdAt: true, warnings: true,
      assets: { select: { id: true, name: true } },
    },
  })
  if (!row || (!row.claimedAt && row.expiresAt < new Date())) return null
  return {
    ...row,
    pages: (row.pages as unknown as ImportPage[] | null) ?? [],
    warnings: row.warnings as unknown as ImportWarnings | null,
  }
}

/**
 * Move an import into the user's account: new skript (unpublished, placed in
 * the site's sidebar by createSkriptForUser), images via saveFile (S3),
 * pages (unpublished). Idempotent per import: a row is claimed once; a
 * concurrent second call gets the already-created skript id back or an error.
 * Not transactional across S3 + DB: on failure mid-way the claim lock is
 * released, and a partially created skript may remain in the account.
 */
export async function claimImport(token: string, userId: string): Promise<{ skriptId: string; skriptSlug: string }> {
  const row = await prisma.scriptImport.findUnique({ where: { token } })
  if (!row || row.status !== 'ready') throw new ClaimError('Import not found or not ready', 404)
  if (row.claimedAt) {
    if (row.claimedByUserId === userId && row.claimedSkriptId) {
      const s = await prisma.skript.findUnique({ where: { id: row.claimedSkriptId }, select: { id: true, slug: true } })
      if (s) return { skriptId: s.id, skriptSlug: s.slug }
    }
    throw new ClaimError('This import was already taken over', 409)
  }
  if (row.expiresAt < new Date()) throw new ClaimError('This import has expired', 410)

  const lock = await prisma.scriptImport.updateMany({
    where: { id: row.id, claimedAt: null },
    data: { claimedAt: new Date(), claimedByUserId: userId },
  })
  if (lock.count === 0) throw new ClaimError('This import was already taken over', 409)

  try {
    const pages = (row.pages as unknown as ImportPage[]) ?? []
    const title = row.title || 'Imported skript'
    let skript: { id: string; slug: string } | null = null
    for (let n = 1; !skript && n <= 20; n++) {
      try {
        const created = await createSkriptForUser(userId, {
          title,
          slug: n === 1 ? pageSlug(title) : `${pageSlug(title)}-${n}`,
          description: 'Imported from Word',
          publish: false,
        })
        skript = { id: created.id, slug: created.slug }
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err
      }
    }
    if (!skript) throw new ClaimError('Could not find a free skript slug', 409)

    const assets = await prisma.scriptImportAsset.findMany({ where: { importId: row.id } })
    for (const a of assets) {
      await saveFile({ buffer: Buffer.from(a.data), filename: a.name, skriptId: skript.id, userId, contentType: a.contentType })
    }
    for (const p of pages) {
      await createPageForUser(userId, { skriptId: skript.id, title: p.title, slug: p.slug, content: p.content })
    }

    await prisma.$transaction([
      prisma.scriptImportAsset.deleteMany({ where: { importId: row.id } }),
      prisma.scriptImport.update({
        where: { id: row.id },
        data: { claimedSkriptId: skript.id, pages: Prisma.DbNull },
      }),
    ])
    return { skriptId: skript.id, skriptSlug: skript.slug }
  } catch (err) {
    await prisma.scriptImport.update({ where: { id: row.id }, data: { claimedAt: null, claimedByUserId: null } }).catch(() => {})
    throw err
  }
}

export class ClaimError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/** Cron: delete unclaimed imports past their retention (assets cascade). */
export async function deleteExpiredImports(now = new Date()): Promise<number> {
  const { count } = await prisma.scriptImport.deleteMany({ where: { claimedAt: null, expiresAt: { lt: now } } })
  return count
}
