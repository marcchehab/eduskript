/**
 * .docx → Markdown, deterministic step of the anonymous skript import.
 *
 * Uses the official pandoc WASM build (npm `pandoc-wasm`, pandoc 3.x) instead
 * of a system binary because the Koyeb buildpack image has no pandoc. The WASM
 * module (~58 MB) is instantiated on first use and stays in memory for the
 * process lifetime. A 30-page docx converts in well under a second.
 *
 * Why pandoc and not mammoth (used by the editor's docx drop,
 * codemirror-editor.tsx): mammoth drops Word equations (OMML) silently and
 * inlines images as base64. pandoc turns OMML into $…$ / $$…$$ TeX, keeps
 * tables, <sub>/<sup>, and extracts images as separate files.
 *
 * Non-web image formats:
 * - WMF is rasterized by wmf-render.ts. WMFs that are the preview picture of
 *   a legacy formula object (Equation Editor 3.0 / MathType OLE, detected via
 *   ProgID in word/document.xml) are named formula-N.png; cleanup.ts has the
 *   vision model transcribe them to LaTeX. Other WMFs become image-N.png.
 * - TIFF/BMP are converted to PNG with sharp.
 * - EMF: the embedded bitmap is extracted (wmf-render.ts renderEmfToPng).
 *   Vector-only EMFs are replaced by an inline note (UNSUPPORTED_IMAGE_NOTE)
 *   and counted in DocxConversion.unsupportedImages.
 *
 * Known limitations:
 * - Text boxes, shapes and SmartArt are lost or flattened by pandoc.
 * - Word's page count comes from docProps/app.xml, which Word writes on save;
 *   files from other tools may lack it (then only the size/char limits apply).
 */
import JSZip from 'jszip'

export interface ImportAsset {
  name: string
  contentType: string
  data: Buffer
}

export interface DocxConversion {
  markdown: string
  assets: ImportAsset[]
  /** Legacy OLE formulas rendered as formula-N.png (to be transcribed). */
  formulaImages: number
  /** Images dropped because their format can't be displayed (EMF, broken WMF). */
  unsupportedImages: number
  /** Text boxes moved into the flow (inlineTextboxes). */
  textboxes: number
  /** Spots where a drawing's label boxes were dropped (DRAWING_NOTE). */
  drawings: number
  /** Word shape drawings rendered to pictures (drawing-render.ts). */
  drawingsRendered: number
  /** Word's own page count (docProps/app.xml), null if absent. */
  pageCount: number | null
}

const WEB_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

/** Inline (images often sit mid-sentence), so it must not be a block callout. */
export const UNSUPPORTED_IMAGE_NOTE = '*[Grafik nicht übernommen (Word-Vektorgrafik)]*'

// Markdown writer: CommonMark + pipe tables + $-math. Pandoc extensions that
// Eduskript does not render (attributes, ~sub~/^sup^, fenced divs, bracketed
// spans) are switched off so pandoc falls back to plain HTML (<sub>, <sup>).
const PANDOC_TO =
  'commonmark_x-attributes-subscript-superscript-bracketed_spans-fenced_divs-raw_attribute-implicit_figures-smart'

interface DocxInfo {
  pageCount: number | null
  /** pandoc media paths (media/<rels target>) of legacy formula previews. */
  formulaMedia: Set<string>
  /** pandoc media path → display width as CSS length ("123pt"), from the docx XML. */
  widths: Map<string, string>
}

/** Word's page count and which media files are legacy-formula previews. */
export async function readDocxInfo(docx: Buffer): Promise<DocxInfo> {
  const info: DocxInfo = { pageCount: null, formulaMedia: new Set(), widths: new Map() }
  try {
    const zip = await JSZip.loadAsync(docx)
    const app = await zip.file('docProps/app.xml')?.async('string')
    const m = app?.match(/<Pages>(\d+)<\/Pages>/)
    if (m) info.pageCount = Number(m[1])

    const doc = (await zip.file('word/document.xml')?.async('string')) ?? ''
    const rels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
    const target = new Map<string, string>()
    for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = r[0].match(/Id="([^"]+)"/)?.[1]
      const t = r[0].match(/Target="([^"]+)"/)?.[1]
      if (id && t) target.set(id, t.replace(/^\/?word\//, ''))
    }
    // <w:object> = OLE object; its <v:imagedata r:id> is the preview picture.
    for (const obj of doc.matchAll(/<w:object\b[\s\S]*?<\/w:object>/g)) {
      if (!/ProgID="(Equation\.|MathType|DSMT)/i.test(obj[0])) continue
      const id = obj[0].match(/<v:imagedata\b[^>]*r:id="([^"]+)"/)?.[1]
      const t = id && target.get(id)
      if (t) info.formulaMedia.add(`media/${t}`)
    }
    // Widths, for images pandoc emits without a style (mostly VML in old files).
    // First occurrence wins when an image is used more than once.
    const setWidth = (id: string | undefined, width: string) => {
      const t = id && target.get(id)
      if (t && !info.widths.has(`media/${t}`)) info.widths.set(`media/${t}`, width)
    }
    for (const shape of doc.matchAll(/<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/g)) {
      const w = shape[1].match(/style="[^"]*\bwidth:([\d.]+)(pt|in|cm|mm|px)/)
      if (w) setWidth(shape[2].match(/<v:imagedata\b[^>]*r:id="([^"]+)"/)?.[1], `${w[1]}${w[2]}`)
    }
    for (const d of doc.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g)) {
      const cx = d[1].match(/<wp:extent cx="(\d+)"/)?.[1]
      if (cx) setWidth(d[1].match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1], `${Number(cx) / 12700}pt`) // EMU → pt
    }
  } catch {
    // Not fatal: without the info, formula previews are treated as images.
  }
  return info
}

async function toPng(data: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    return await sharp(data).png().toBuffer()
  } catch {
    return null
  }
}

/**
 * Drop Word's table of contents: paragraphs whose style is a TOC style. Style
 * IDs are localized ("Verzeichnis1", "TOC1", "TM1"), the style *names* in
 * styles.xml are not ("toc 1", "TOC Heading"). Eduskript has its own page
 * navigation, and TOC entries become links with page numbers (and broken math
 * when a heading holds a formula). TOC paragraphs never nest, so a
 * non-greedy per-paragraph regex is enough. O(n).
 */
export function removeToc(doc: string, styles: string): { xml: string; removed: number } {
  const ids = new Set(
    Array.from(styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>\s*<w:name w:val="([^"]+)"/g))
      .filter((m) => /^toc (\d|heading)/i.test(m[2]))
      .map((m) => m[1])
  )
  if (!ids.size) return { xml: doc, removed: 0 }
  let removed = 0
  const xml = doc.replace(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, (p) => {
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1]
    if (!style || !ids.has(style)) return p
    removed++
    return ''
  })
  return { xml, removed }
}

/** Text fallback for TOCs without TOC styles (e.g. converted .doc): ≥ 3 lines "Title [page](#anchor)". */
export function removeTocText(md: string): string {
  return md
    // Entry = "Title [5](#a)" or "[Title 5](#a)"; a run of ≥ 3 is a TOC.
    .replace(/(?:^(?:[^\n]*\[\d+\]|\[[^\n]*?\s\d+\])\(#[^)\s]*\)[ \t]*(?:\n+|$)){3,}/gm, '')
    .replace(/^(?:#{1,6}\s*)?\**(?:Inhaltsverzeichnis|Inhalt|Table of Contents|Contents)\**\s*\n+(?=\S)/gim, (m, offset, all) =>
      // Only drop the heading line if no list follows it anymore (i.e. the entries were removed).
      /^\s*(?:\[|\d+(?:\.\d+)*\s)/.test(all.slice(offset + m.length)) ? m : ''
    )
}

/** Rewrite word/document.xml: TOC removed, text boxes inlined (see removeToc, inlineTextboxes). */
async function preprocess(docx: Buffer): Promise<{ docx: Buffer; textboxes: number; drawings: number; rendered: number }> {
  const none = { docx, textboxes: 0, drawings: 0, rendered: 0 }
  try {
    const zip = await JSZip.loadAsync(docx)
    // Word shape drawings → pictures first, so their text boxes aren't inlined as text.
    let rendered = 0
    try {
      const { renderDrawings } = await import('./drawing-render')
      rendered = await renderDrawings(zip)
    } catch (err) {
      console.warn('[script-import] drawing rendering failed, continuing without:', err)
    }
    const original = await zip.file('word/document.xml')?.async('string')
    if (!original) return none
    const styles = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    const toc = removeToc(original, styles)
    const { xml, count, drawings } = inlineTextboxes(toc.xml)
    if (!count && !drawings && !toc.removed && !rendered) return none
    zip.file('word/document.xml', xml)
    return { docx: await zip.generateAsync({ type: 'nodebuffer' }), textboxes: count, drawings, rendered }
  } catch {
    return none
  }
}

export async function convertDocx(original: Buffer): Promise<DocxConversion> {
  const { docx, textboxes, drawings, rendered } = await preprocess(original)
  // Dynamic import: the module instantiates the WASM binary at import time.
  const { convert } = await import('pandoc-wasm')
  const result = await convert(
    {
      from: 'docx',
      to: PANDOC_TO,
      'extract-media': 'media',
      'input-files': ['in.docx'],
      wrap: 'none',
    },
    null,
    { 'in.docx': new Blob([new Uint8Array(docx)]) }
  )
  if (!result.stdout && result.stderr) {
    throw new Error(`pandoc: ${result.stderr.slice(0, 500)}`)
  }
  const info = await readDocxInfo(docx)

  // pandoc names media after the docx part (media/media/image3.wmf) or the
  // relationship id. Rename to stable names in document order.
  const assets: ImportAsset[] = []
  const renamed = new Map<string, string | null>() // pandoc path → new name, null = unsupported
  let images = 0
  let formulas = 0
  let unsupported = 0
  for (const [path, blob] of Object.entries(result.mediaFiles as Record<string, Blob>)) {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    let data: Buffer | null = Buffer.from(await blob.arrayBuffer())
    let contentType = WEB_IMAGE_TYPES[ext]
    let outExt = ext === 'jpeg' ? 'jpg' : ext
    if (!contentType) {
      if (ext === 'wmf') {
        const { renderWmfToPng } = await import('./wmf-render')
        data = renderWmfToPng(data)
      } else if (ext === 'emf') {
        const { renderEmfToPng } = await import('./wmf-render')
        data = await renderEmfToPng(data)
      } else if (ext === 'tif' || ext === 'tiff' || ext === 'bmp') {
        data = await toPng(data)
      } else {
        data = null
      }
      contentType = 'image/png'
      outExt = 'png'
    }
    if (!data) {
      renamed.set(path, null)
      unsupported++
      continue
    }
    // pandoc path is media/<zip path relative to word/>, e.g. media/media/image3.wmf
    const isFormula = info.formulaMedia.has(path)
    const name = isFormula ? `formula-${++formulas}.${outExt}` : `image-${++images}.${outExt}`
    renamed.set(path, name)
    assets.push({ name, contentType, data })
  }

  const markdown = removeTocText(
    rewriteImages(result.stdout, renamed, info.widths).replace(new RegExp(`^${DRAWING_MARKER}$`, 'gm'), DRAWING_NOTE)
  )
  return { markdown, assets, pageCount: info.pageCount, formulaImages: formulas, unsupportedImages: unsupported, textboxes, drawings, drawingsRendered: rendered }
}

/** Word's usable text width (A4, 2.5 cm margins) in inches; image widths are relative to it. */
const TEXT_WIDTH_IN = 6.3
const UNITS_PER_IN: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4, px: 96, pt: 72 }

/** Width in % of the text width from pandoc's style="width:5.2in", null if absent/≥ 90%. */
export function widthPercent(style: string): number | null {
  const m = style.match(/width:\s*([\d.]+)(in|cm|mm|px|pt)/)
  if (!m) return null
  const pct = Math.round((Number(m[1]) / UNITS_PER_IN[m[2]] / TEXT_WIDTH_IN) * 100)
  return pct > 0 && pct < 90 ? Math.max(pct, 5) : null
}

/**
 * Replace pandoc's image output with Eduskript image syntax:
 * - `<figure><img src alt …/><figcaption>…</figcaption></figure>` (captioned)
 * - bare `<img src alt style="width:…"/>` (sized images)
 * - `![alt](media/media/rIdN.png)` (unsized)
 * Images narrower than 90% of the page keep their Word size as
 * `<img src alt style="width: N%" />`; others become `![alt](name)`. Formula
 * pictures always become `![](formula-N.png)` (cleanup.ts transcribes those).
 * Unsupported formats become UNSUPPORTED_IMAGE_NOTE. O(n) regex passes.
 */
export function rewriteImages(
  md: string,
  renamed: Map<string, string | null>,
  widths: Map<string, string> = new Map()
): string {
  const toMd = (src: string, alt: string, pandocStyle = '') => {
    const style = pandocStyle || (widths.has(src) ? `width:${widths.get(src)}` : '')
    const name = renamed.get(src)
    if (name === undefined) return `![${alt}](${src})`
    if (name === null) return UNSUPPORTED_IMAGE_NOTE
    const cleanAlt = alt.replace(/[[\]"<>]/g, '')
    const pct = name.startsWith('formula-') ? null : widthPercent(style)
    return pct ? `<img src="${name}" alt="${cleanAlt}" style="width: ${pct}%" />` : `![${cleanAlt}](${name})`
  }
  const attr = (tag: string, key: string) =>
    tag.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? ''

  return md
    .replace(/<figure>\s*(<img[^>]*>)[\s\S]*?<\/figure>/g, (_, img: string) =>
      toMd(attr(img, 'src'), attr(img, 'alt'), attr(img, 'style'))
    )
    .replace(/<img[^>]*>/g, (img) =>
      renamed.has(attr(img, 'src')) ? toMd(attr(img, 'src'), attr(img, 'alt'), attr(img, 'style')) : img
    )
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => toMd(src, alt))
}

export const TEXTBOX_START = 'TEXTFELD-ANFANG'
export const TEXTBOX_END = 'TEXTFELD-ENDE'
/** Block note where a Word drawing (shapes + short label boxes) was. Own paragraph, so a callout works. */
export const DRAWING_NOTE =
  '> [!warning] Zeichnung fehlt\n> Diese Zeichnung ist in Word aus Formen (Linien, Pfeile, Kästchen) gebaut und kann nicht übernommen werden. Tipp: In Word die Zeichnung markieren, Rechtsklick → «Als Grafik speichern» und das Bild hier einfügen.'
const DRAWING_MARKER = 'ZEICHNUNG-FEHLT' // replaced by DRAWING_NOTE after pandoc
/** Text boxes with less plain text than this are treated as drawing labels. */
const LABEL_MAX_CHARS = 25
const markerParagraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

/**
 * Move text box content into the document flow, since pandoc drops most of
 * it (DrawingML text boxes, mc:AlternateContent). Each <w:txbxContent> in an
 * mc:Choice / plain drawing is emptied in place and its paragraphs are
 * inserted after the outermost enclosing paragraph, between TEXTBOX_START/END
 * marker paragraphs (cleanup.ts turns them into callouts; leftovers are
 * stripped). Copies inside mc:Fallback (VML duplicates of the Choice) are
 * emptied without being moved.
 *
 * Text boxes with < LABEL_MAX_CHARS of text, no Word formula (OMML) and at
 * most one legacy formula object are labels of a drawing (arrows, sketches built from Word shapes) — without
 * the shapes they're meaningless, so they're dropped and a single
 * DRAWING_NOTE paragraph marks the spot. Heuristic: a real one-line note
 * shorter than that is dropped too. Tag scan with a stack, O(n); assumes
 * well-formed XML (Word output).
 */
export function inlineTextboxes(xml: string): { xml: string; count: number; drawings: number } {
  const tag = /<(\/?)(w:p|w:txbxContent|mc:Fallback)\b[^>]*?(\/?)>/g
  const out: string[] = []
  let last = 0
  let pDepth = 0
  let fallbackDepth = 0
  let boxStart = -1 // index in xml where the current top-level txbxContent's inner starts
  let boxDepth = 0
  const pending: string[] = [] // extracted content waiting for the outer paragraph to close
  let labels = 0 // label boxes seen in the current outer paragraph
  let count = 0
  let drawings = 0
  for (let m; (m = tag.exec(xml)); ) {
    const [full, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (name === 'mc:Fallback') {
      fallbackDepth += closing ? -1 : 1
      continue
    }
    if (name === 'w:txbxContent') {
      if (!closing) {
        if (boxDepth++ === 0) {
          boxStart = m.index + full.length
          out.push(xml.slice(last, boxStart))
          last = boxStart
        }
      } else if (--boxDepth === 0) {
        const inner = xml.slice(boxStart, m.index)
        if (fallbackDepth === 0 && /<w:t[ >]|<w:object|<m:oMath\b/.test(inner)) {
          const text = Array.from(inner.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (t) => t[1]).join('').trim()
          const objects = (inner.match(/<w:object\b/g) ?? []).length
          // Word formulas (OMML) are content even when short: keep them.
          const omml = /<m:oMath\b/.test(inner)
          if (!omml && text.length < LABEL_MAX_CHARS && objects <= 1) {
            labels++
          } else {
            pending.push(markerParagraph(TEXTBOX_START), inner, markerParagraph(TEXTBOX_END))
            count++
          }
        }
        out.push('<w:p/>') // emptied in place
        last = m.index
      }
      continue
    }
    if (boxDepth > 0) continue // paragraphs inside a text box
    if (!closing) pDepth++
    else if (--pDepth === 0 && (pending.length || labels)) {
      const end = m.index + full.length
      if (labels) {
        pending.push(markerParagraph(DRAWING_MARKER))
        drawings++
        labels = 0
      }
      out.push(xml.slice(last, end), ...pending)
      pending.length = 0
      last = end
    }
  }
  out.push(xml.slice(last))
  return { xml: out.join(''), count, drawings }
}
