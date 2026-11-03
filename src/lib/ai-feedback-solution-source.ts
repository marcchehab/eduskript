/**
 * Read and rewrite the `solution` attribute of one `<ai-feedback>` tag in
 * page source, for the editor's "Provide solution" gizmo.
 *
 * The rendered tag never carries `solution` (the sanitizer strips it so it
 * can't reach public pages, see markdown-compiler.ts), so the gizmo works on
 * the source instead, keyed by the tag's 1-based source line
 * (data-source-line-start). Tags inside fenced code blocks are ignored.
 */

import { fencedRanges } from '@/lib/markdown-fences'
import { isSolutionImageFile } from '@/lib/ai/feedback-context'

const TAG_RE = /<ai-feedback\b[^>]*>/gi
const SOLUTION_RE = /\s+solution\s*=\s*"[^"]*"/i

function findTag(content: string, line: number): { start: number; text: string } | null {
  const fences = fencedRanges(content)
  for (const match of content.matchAll(TAG_RE)) {
    const start = match.index
    if (fences.some(([fs, fe]) => start >= fs && start < fe)) continue
    const tagLine = content.slice(0, start).split('\n').length
    if (tagLine === line) return { start, text: match[0] }
  }
  return null
}

/** The tag's solution value, '' when it has none, null when no tag is on that line. */
export function getAiFeedbackSolution(content: string, line: number): string | null {
  const tag = findTag(content, line)
  if (!tag) return null
  return tag.text.match(/\bsolution\s*=\s*"([^"]*)"/i)?.[1].trim() ?? ''
}

/** Content with the tag's solution set (or removed for null); null when no tag is on that line. */
export function setAiFeedbackSolution(content: string, line: number, solution: string | null): string | null {
  const tag = findTag(content, line)
  if (!tag) return null
  let text = tag.text.replace(SOLUTION_RE, '')
  if (solution) {
    const value = solution.replace(/"/g, '')
    text = text.replace(/\s*(\/?>)$/, ` solution="${value}" $1`).replace(/ +>$/, '>')
  }
  return content.slice(0, tag.start) + text + content.slice(tag.start + tag.text.length)
}

/**
 * Content with a `<solution hidden>` block holding the drawing/image `name`
 * inserted after the tag on `line` (after its closing tag when it has one);
 * null when no tag is on that line. Images use ![](name), anything else
 * <excali src>, the same split as solutionFilename().
 */
export function insertHiddenSolution(content: string, line: number, name: string): string | null {
  const tag = findTag(content, line)
  if (!tag) return null
  let end = tag.start + tag.text.length
  if (!tag.text.endsWith('/>')) {
    const close = content.slice(end).search(/<\/ai-feedback>/i)
    if (close !== -1) end += close + '</ai-feedback>'.length
  }
  const eol = content.indexOf('\n', end)
  const at = eol === -1 ? content.length : eol
  const ref = name.replace(/"/g, '')
  const body = isSolutionImageFile(ref) ? `![](${ref})` : `<excali src="${ref}" />`
  return `${content.slice(0, at)}\n\n<solution hidden>\n\n${body}\n\n</solution>${content.slice(at)}`
}
