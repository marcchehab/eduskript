/**
 * TikZ rendering for a skript: puts the skript's `tikz-preamble.tex` (if it has
 * one) in front of the block. Node-only, like render.server.ts.
 */
import { resolveFile, type SkriptFilesData } from '@/lib/skript-files'
import { TIKZ_MAX_SOURCE, TIKZ_PREAMBLE_FILE } from './document'
import { renderTikz, type TikzResult } from './render.server'

// File URLs are content-addressed (the hash is in the URL), so a fetched
// preamble never changes under its URL.
const preambles = new Map<string, string>()

async function fetchPreamble(url: string): Promise<string> {
  const known = preambles.get(url)
  if (known !== undefined) return known
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = (await response.text()).slice(0, TIKZ_MAX_SOURCE + 1)
  if (preambles.size > 200) preambles.clear()
  preambles.set(url, text)
  return text
}

export async function renderTikzForSkript(source: string, files: SkriptFilesData | undefined): Promise<TikzResult> {
  const file = files ? resolveFile(files, TIKZ_PREAMBLE_FILE) : undefined
  let preamble = ''
  if (file) {
    try {
      preamble = await fetchPreamble(file.url)
    } catch (error) {
      return { error: `Could not load ${TIKZ_PREAMBLE_FILE}: ${(error as Error).message}` }
    }
  }
  return renderTikz(source, preamble)
}
