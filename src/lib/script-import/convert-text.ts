/**
 * Pasted text → Markdown, deterministic step of the anonymous import (the
 * model cleanup in cleanup.ts follows, as for Word).
 *
 * Format detection is rule-based (no model call): LaTeX by its commands,
 * Markdown by its line syntax, else the clipboard's HTML flavour if the
 * browser sent one (copied from Word, Google Docs, a website), else HTML tags
 * in the text, else plain text (treated as Markdown). LaTeX and HTML go
 * through native pandoc (pandoc.ts) with the same writer options as .docx, so $…$ math
 * survives. Order matters: an editor like VS Code also puts syntax-coloured
 * HTML on the clipboard, so recognisable LaTeX/Markdown text wins over it.
 *
 * Images in pasted HTML: data: URIs become assets (image-N.ext); http(s)
 * images are kept as remote URLs; file:/cid: references (Word's clipboard
 * points at local temp files) can't be fetched and become a note.
 */
import { PANDOC_TO, removeTocText, type ImportAsset } from './convert-docx'
import { runPandoc } from './pandoc'

export type TextFormat = 'latex' | 'html' | 'markdown'

export const MISSING_CLIPBOARD_IMAGE_NOTE = '*[Bild beim Einfügen nicht mitgekommen – Datei hochladen statt Text einfügen]*'

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length

export function detectTextFormat(text: string, html?: string | null): TextFormat {
  const latex = count(/\\(?:documentclass|usepackage|begin\{|end\{|(?:sub)*section\*?\{|chapter\{|textbf\{|textit\{|emph\{|item\b|frac\{)/g, text)
  if (/\\documentclass|\\begin\{document\}/.test(text) || latex >= 3) return 'latex'
  const markdown = count(/^(?:#{1,6} |[-*+] |\d+\. |> |```|\|.*\|\s*$|\$\$)/gm, text)
  if (markdown >= 3) return 'markdown'
  if (html && /<[a-z][\s\S]*>/i.test(html)) return 'html'
  if (count(/<(?:p|div|h[1-6]|table|ul|ol|li|br)\b[^>]*>/gi, text) >= 2) return 'html'
  return 'markdown'
}

const MIME_EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg' }

/** Pull data: images out of HTML into assets; drop unreachable local refs. O(n). */
export function extractHtmlImages(html: string): { html: string; assets: ImportAsset[]; dropped: number } {
  const assets: ImportAsset[] = []
  let dropped = 0
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''
    const data = src.match(/^data:image\/([a-z+]+);base64,(.+)$/i)
    if (data && MIME_EXT[data[1].toLowerCase()]) {
      const ext = MIME_EXT[data[1].toLowerCase()]
      const name = `image-${assets.length + 1}.${ext}`
      assets.push({ name, contentType: `image/${data[1].toLowerCase()}`, data: Buffer.from(data[2], 'base64') })
      return tag.replace(src, name)
    }
    if (/^https?:\/\//i.test(src)) return tag
    dropped++
    return '<span>MISSINGIMAGE</span>'
  })
  return { html: out, assets, dropped }
}

export interface TextConversion {
  markdown: string
  assets: ImportAsset[]
  format: TextFormat
  unsupportedImages: number
}

export async function convertText(text: string, html?: string | null): Promise<TextConversion> {
  const format = detectTextFormat(text, html)
  if (format === 'markdown') return { markdown: text.trim(), assets: [], format, unsupportedImages: 0 }

  let source = text
  let assets: ImportAsset[] = []
  let dropped = 0
  if (format === 'html') {
    const extracted = extractHtmlImages(html && /<[a-z][\s\S]*>/i.test(html) ? html : text)
    source = extracted.html
    assets = extracted.assets
    dropped = extracted.dropped
  }
  const result = await runPandoc({ from: format, to: PANDOC_TO, input: source })
  const markdown = removeTocText(result.stdout.replace(/MISSINGIMAGE/g, MISSING_CLIPBOARD_IMAGE_NOTE)).trim()
  return { markdown, assets, format, unsupportedImages: dropped }
}
