/**
 * PDF → Markdown for the anonymous import. Unlike .docx there is no document
 * structure to convert, so the model reads each page:
 *
 * 1. pdfjs-dist (legacy build, Node) renders every page to PNG at RENDER_SCALE
 *    on @napi-rs/canvas, and extracts the page's text layer.
 * 2. Gemini gets page image + text layer (helps exact transcription; its
 *    order may be wrong) and writes Eduskript Markdown directly, with the
 *    cleanup rules from cleanup.ts — so PDF imports skip the separate cleanup
 *    pass. Figures come back as <figure box="ymin,xmin,ymax,xmax" alt="…"/>
 *    (0–1000 page coordinates).
 * 3. Each box is cut out of the rendered page (sharp) with FIGURE_PAD margin,
 *    because model boxes are approximate (not pixel-exact; labels at the edge
 *    may be cut or neighbouring text included).
 *
 * A page whose model call fails is kept as a full-page image, so no content
 * is lost. Scanned PDFs take the same path (the model reads the image).
 * Known limits: paragraphs split across pages stay split; multi-column
 * layouts depend on the model's reading order; embedded raster images are
 * cropped from the render instead of extracted losslessly.
 */
import path from 'path'
import type OpenAI from 'openai'
import { callImportModel, CLEANUP_RULES, mapConcurrent } from './cleanup'
import type { ImportAsset } from './convert-docx'
import { ImportError } from './limits'

const RENDER_SCALE = 2 // 144 dpi
const FIGURE_PAD = 0.006 // of page size, each side
const MIN_FIGURE_AREA = 0.004 // of page area; smaller boxes are noise
const TEXT_WIDTH_PT = 6.3 * 72 // Word's text width, as in convert-docx widthPercent
const PAGE_CONCURRENCY = 4

const PAGE_SYSTEM = `Du liest EINE Seite eines Unterrichtsskripts aus einer PDF-Datei und schreibst sie als Markdown für die Plattform Eduskript. Du bekommst das Seitenbild und, falls vorhanden, die Textschicht der PDF. Die Textschicht hilft beim genauen Abschreiben (Zahlen, Namen), ihre Reihenfolge kann aber falsch sein; massgebend ist das Bild.

Pflicht:
- Den gesamten Inhalt der Seite in Lesereihenfolge wiedergeben. Nichts kürzen, zusammenfassen, ergänzen oder übersetzen.
- Kopfzeilen, Fusszeilen und Seitenzahlen weglassen.
- Überschriften: Titel des Dokuments (nur auf der ersten Seite) als #, Kapitel als ##, Unterkapitel als ###. Beginnt die Seite mitten in einem Absatz, einfach mit dem Text beginnen.
- Formeln als LaTeX ($…$ im Text, $$…$$ abgesetzt), Chemie mit mhchem ($\\ce{…}$). Tabellen als Markdown-Tabellen.
- Abbildungen (Fotos, Diagramme, Skizzen, Grafiken, Schaltbilder) NICHT beschreiben, sondern an ihrer Stelle als eigene Zeile ausgeben: <figure box="ymin,xmin,ymax,xmax" alt="kurze Beschreibung"/> mit ganzzahligen Koordinaten 0–1000 relativ zum Seitenbild (0,0 = oben links). Der Rahmen umfasst die ganze Abbildung inklusive Beschriftungen im Bild, aber keinen Fliesstext. Eine Bildunterschrift als normalen Text darunter.

Für das Eduskript-Markdown gelten zusätzlich diese Regeln (Hinweise zu Bild- und Formelreferenzen dort betreffen dich nicht):

${CLEANUP_RULES}`

export interface PdfConversion {
  markdown: string
  assets: ImportAsset[]
  pageCount: number
  costUsd: number
  /** Pages kept as a full-page image because reading them failed. */
  failedPages: number
  figures: number
}

interface RenderedPage {
  png: Buffer
  jpeg: Buffer
  width: number // px
  height: number
  widthPt: number
  text: string
}

async function openPdf(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const root = path.join(process.cwd(), 'node_modules/pdfjs-dist')
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    standardFontDataUrl: `${root}/standard_fonts/`,
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
  })
  try {
    const doc = await task.promise
    // destroy() lives on the loading task in pdfjs 6; it frees the worker and all pages.
    return Object.assign(doc, { close: () => task.destroy() })
  } catch (err) {
    await task.destroy().catch(() => {})
    console.warn('[script-import] pdf open failed:', err)
    throw new ImportError('The PDF could not be read. Is it password-protected or damaged?')
  }
}

type PdfDoc = Awaited<ReturnType<typeof openPdf>>

async function renderPage(doc: PdfDoc, n: number): Promise<RenderedPage> {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: RENDER_SCALE })
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise
  const content = await page.getTextContent()
  const text = content.items
    .map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : ''))
    .join('')
    .trim()
  const png = canvas.toBuffer('image/png')
  const sharp = (await import('sharp')).default
  // The model gets a JPEG (a fraction of the PNG's size); crops come from the PNG.
  const jpeg = await sharp(png).jpeg({ quality: 82 }).toBuffer()
  page.cleanup()
  return { png, jpeg, width: canvas.width, height: canvas.height, widthPt: vp.width / RENDER_SCALE, text }
}

const FIGURE_RE = /<figure\b[^>]*?\bbox\s*=\s*["'](\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)["'][^>]*?\/?>(?:\s*<\/figure>)?/gi

/** Cut model figure boxes out of the page; replace placeholders with image refs. O(figures). */
export async function cropFigures(
  md: string,
  page: Pick<RenderedPage, 'png' | 'width' | 'height' | 'widthPt'>,
  nextName: () => string
): Promise<{ markdown: string; assets: ImportAsset[] }> {
  const sharp = (await import('sharp')).default
  const assets: ImportAsset[] = []
  let out = md
  for (const m of Array.from(md.matchAll(FIGURE_RE))) {
    const [y0, x0, y1, x1] = [m[1], m[2], m[3], m[4]].map((v) => Math.min(1000, Math.max(0, Number(v))) / 1000)
    const alt = (m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').replace(/[[\]"<>]/g, '')
    if (y1 <= y0 || x1 <= x0 || (y1 - y0) * (x1 - x0) < MIN_FIGURE_AREA) {
      out = out.replace(m[0], '')
      continue
    }
    const left = Math.max(0, Math.floor((x0 - FIGURE_PAD) * page.width))
    const top = Math.max(0, Math.floor((y0 - FIGURE_PAD) * page.height))
    const right = Math.min(page.width, Math.ceil((x1 + FIGURE_PAD) * page.width))
    const bottom = Math.min(page.height, Math.ceil((y1 + FIGURE_PAD) * page.height))
    const data = await sharp(page.png).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer()
    const name = nextName()
    assets.push({ name, contentType: 'image/png', data })
    const pct = Math.round((((right - left) / page.width) * page.widthPt * 100) / TEXT_WIDTH_PT)
    out = out.replace(
      m[0],
      pct < 90 ? `<img src="${name}" alt="${alt}" style="width: ${Math.max(pct, 10)}%" />` : `![${alt}](${name})`
    )
  }
  return { markdown: out, assets }
}

/** PDF page count without rendering (for the upload limit). */
export async function pdfPageCount(buf: Buffer): Promise<number> {
  const doc = await openPdf(buf)
  const n = doc.numPages
  await doc.close()
  return n
}

export async function convertPdf(buf: Buffer, maxPages: number): Promise<PdfConversion> {
  const doc = await openPdf(buf)
  try {
    if (doc.numPages > maxPages) {
      throw new ImportError(`The PDF has ${doc.numPages} pages; the limit is ${maxPages}.`)
    }
    const pageNumbers = Array.from({ length: doc.numPages }, (_, i) => i + 1)
    let imageCounter = 0
    const nextName = () => `image-${++imageCounter}.png`

    const results = await mapConcurrent(
      pageNumbers,
      async (n) => {
        const page = await renderPage(doc, n)
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${page.jpeg.toString('base64')}` } },
          { type: 'text', text: page.text ? `Seite ${n} von ${doc.numPages}. Textschicht der PDF:\n\n${page.text}` : `Seite ${n} von ${doc.numPages}. Keine Textschicht (gescannte Seite).` },
        ]
        try {
          const r = await callImportModel(PAGE_SYSTEM, content)
          if (r.finish !== 'stop' || !r.text.trim()) throw new Error(`finish=${r.finish}`)
          return { page, text: r.text, cost: r.cost, ok: true }
        } catch (err) {
          console.error(`[script-import] pdf page ${n} failed, keeping it as an image:`, err)
          return { page, text: `<figure box="0,0,1000,1000" alt="Seite ${n}"/>`, cost: 0, ok: false }
        }
      },
      PAGE_CONCURRENCY
    )

    // Crops in page order, so image numbers follow the document.
    const parts: string[] = []
    const assets: ImportAsset[] = []
    for (const r of results) {
      const cropped = await cropFigures(r.text, r.page, nextName)
      parts.push(cropped.markdown)
      assets.push(...cropped.assets)
    }
    return {
      markdown: parts.join('\n\n').trim(),
      assets,
      pageCount: doc.numPages,
      costUsd: results.reduce((s, r) => s + r.cost, 0),
      failedPages: results.filter((r) => !r.ok).length,
      figures: assets.length,
    }
  } finally {
    await doc.close()
  }
}
