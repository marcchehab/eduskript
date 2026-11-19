/**
 * ```tikz fence → TeX document. Pure and isomorphic: the editor preview and the
 * server build the same document from the same inputs, and the document string
 * is the cache key.
 *
 * The fence body is TikZ as the author wrote it:
 *
 *   ```tikz
 *   % alt: Automat mit zwei Zuständen
 *   \usetikzlibrary{automata, positioning}
 *   \begin{tikzpicture}
 *     \node[state, initial] (q0) {$q_0$};
 *   \end{tikzpicture}
 *   ```
 *
 * `\usetikzlibrary` and `\usepackage` lines may stand anywhere in the body; they
 * are moved to the preamble. A body without a `tikzpicture` (and without a
 * macro from the skript preamble that provides one) is wrapped in one.
 *
 * The skript preamble is the file `tikz-preamble.tex` in the skript's files:
 * colours, styles and macros shared by every diagram of the skript.
 */

/** Skript file that is put in front of every ```tikz block of the skript. */
export const TIKZ_PREAMBLE_FILE = 'tikz-preamble.tex'

/** Loaded for every block, so the common diagrams need no \usetikzlibrary line. */
export const DEFAULT_TIKZ_LIBRARIES = ['automata', 'positioning', 'arrows.meta', 'calc']

/** Packages node-tikzjax ships; any other \usepackage would stop TeX with a missing file. */
export const TIKZ_PACKAGES = ['amsmath', 'amstext', 'amsfonts', 'amssymb', 'array', 'pgfplots', 'tikz-cd', 'circuitikz', 'chemfig', 'tikz-3dplot']

/** Longest fence body and preamble accepted, in characters. */
export const TIKZ_MAX_SOURCE = 20_000

export interface TikzDocument {
  /** Everything between \documentclass and \begin{document}, without the libraries. */
  preamble: string
  /** Comma-separated TikZ libraries. */
  libraries: string
  /** package → options. */
  packages: Record<string, string>
  /** Document body, without \begin{document} / \end{document}. */
  body: string
  alt?: string
  caption?: string
  /** Stable cache key: the same inputs give the same key on client and server. */
  key: string
}

export type TikzDocumentResult = { document: TikzDocument } | { error: string }

const LIBRARY_LINE = /\\usetikzlibrary\s*\{([^}]*)\}/g
const PACKAGE_LINE = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g
const DIRECTIVE = /^[ \t]*%[ \t]*(alt|caption)[ \t]*:[ \t]*(.*)$/gim

/** Split \usetikzlibrary / \usepackage lines off a piece of TeX. */
function extract(tex: string, libraries: Set<string>, packages: Record<string, string>): string {
  return tex
    .replace(LIBRARY_LINE, (_all, list: string) => {
      for (const name of list.split(',')) if (name.trim()) libraries.add(name.trim())
      return ''
    })
    .replace(PACKAGE_LINE, (_all, options: string | undefined, list: string) => {
      for (const name of list.split(',')) if (name.trim()) packages[name.trim()] = options?.trim() ?? ''
      return ''
    })
}

/** Remove TeX comments (a `%` not preceded by a backslash, up to the line end). */
function stripComments(tex: string): string {
  return tex.replace(/(^|[^\\])%.*$/gm, '$1')
}

export function buildTikzDocument(source: string, skriptPreamble = ''): TikzDocumentResult {
  if (source.length > TIKZ_MAX_SOURCE || skriptPreamble.length > TIKZ_MAX_SOURCE) {
    return { error: `TikZ source is too long (limit: ${TIKZ_MAX_SOURCE} characters).` }
  }

  let alt: string | undefined
  let caption: string | undefined
  for (const match of source.matchAll(DIRECTIVE)) {
    if (match[1].toLowerCase() === 'alt') alt = match[2].trim()
    else caption = match[2].trim()
  }

  const libraries = new Set(DEFAULT_TIKZ_LIBRARIES)
  const packages: Record<string, string> = {}

  // The document frame is ours; a pasted full document keeps only its content.
  const unframe = (tex: string) =>
    tex
      .replace(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '')
      .replace(/\\(?:begin|end)\s*\{document\}/g, '')

  const preamble = extract(unframe(stripComments(skriptPreamble)), libraries, packages).trim()
  let body = extract(unframe(stripComments(source)), libraries, packages).trim()

  if (!body) return { error: 'The tikz block is empty.' }

  const unknown = Object.keys(packages).filter((name) => name !== 'tikz' && !TIKZ_PACKAGES.includes(name))
  if (unknown.length > 0) {
    return { error: `Package not available: ${unknown.join(', ')}. Available: ${TIKZ_PACKAGES.join(', ')}.` }
  }
  delete packages.tikz // always loaded

  if (!/\\begin\s*\{tikzpicture\}/.test(body) && !startsWithPreambleMacro(body, preamble) && !/\\begin\s*\{(?:tikzcd|circuitikz|axis)\}/.test(body)) {
    body = `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`
  }

  const libraryList = [...libraries].join(',')
  const key = [libraryList, JSON.stringify(packages), preamble, body].join('\u0000')
  return { document: { preamble, libraries: libraryList, packages, body, alt, caption, key } }
}

/** `\zd{…}` in the body, with `\newcommand{\zd}` in the preamble: the macro brings its own tikzpicture. */
function startsWithPreambleMacro(body: string, preamble: string): boolean {
  const first = /^\\([A-Za-z@]+)/.exec(body)
  if (!first) return false
  const name = first[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\\\(?:re)?newcommand\\*?\\s*\\{?\\\\${name}\\b|\\\\def\\s*\\\\${name}\\b|\\\\NewDocumentCommand\\s*\\{?\\\\${name}\\b`).test(preamble)
}
