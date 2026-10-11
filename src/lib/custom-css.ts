/**
 * Sanitizer for a site's free-form custom CSS (theme editor,
 * Site.extraSettings.customCss).
 *
 * The CSS itself is NOT restricted — selectors, properties, nesting, @media,
 * @font-face etc. all pass through untouched. The only goals are:
 *
 * 1. No external loads. Student privacy (see /datenschutz): every request a
 *    student's browser makes must stay with Eduskript. So:
 *      - `@import` rules are removed entirely (whatever they point at);
 *      - `url(…)` / `src(…)` and the string URLs inside `image-set(…)` are kept
 *        only when they point at Eduskript-served files (see isAllowedUrl);
 *        anything else is replaced by `none`, which makes the declaration
 *        invalid or imageless — the browser drops it, nothing is fetched.
 * 2. No breaking out of the <style> element: every `<` is rewritten to the
 *    CSS escape `\3c ` (same character inside strings; outside strings `<` is
 *    never valid CSS anyway), so `</style` cannot appear in the output.
 *
 * Implementation: a small single-pass tokenizer modelled on CSS Syntax Level
 * 3 — strings, comments, idents (with escapes decoded for comparison only),
 * at-keywords, functions and unquoted url tokens. Matching is done on the
 * DECODED names, so `@\69mport` and `u\72l(` are caught like the browser
 * would read them. It deliberately over-detects in a few edge cases (e.g.
 * `#url(` or `5url(` are treated as url functions); over-detection only ever
 * removes a URL, it never lets one through. O(n) in the input length.
 *
 * Pure module (no env, no DB) so the theme editor can run it client-side for
 * the live preview. Server code passes the allowlist via options; see
 * src/lib/site-theme.ts.
 */

export interface CustomCssOptions {
  /**
   * Absolute URL prefixes that are allowed in url(), e.g. the public base of
   * the teacher-file bucket (`https://…/bucket/files/`). Only the remainder
   * after the prefix is checked (strict filename charset).
   */
  allowedUrlPrefixes?: readonly string[]
  /**
   * Relative file names (`url(bg.png)`) → resolved absolute URL. Names not in
   * the map are removed. The save route fills this from the files of skripts
   * placed on the site; render-time sanitizing passes nothing (stored CSS
   * already holds the resolved URLs).
   */
  relativeFiles?: Readonly<Record<string, string>>
}

export interface RemovedCssItem {
  kind: 'import' | 'url'
  /** The offending URL / at-rule text, decoded, truncated to 200 chars. */
  value: string
  /** True for a bare relative name that could be resolvable (`bg.png`). */
  relative?: boolean
}

export interface SanitizedCss {
  css: string
  removed: RemovedCssItem[]
}

/**
 * Root-relative paths the app itself serves and that are safe to load:
 * self-hosted fonts in public/fonts, next/font output, and the file proxy
 * (/api/files/<id>, redirects to the teacher-file bucket).
 */
const ALLOWED_ROOT_PATHS = /^\/(?:fonts|_next\/static\/media|api\/files)\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+)*(?:[?#][A-Za-z0-9._~%=&-]*)?$/
/** What may follow an allowed absolute prefix (content-addressed keys). */
const ALLOWED_SUFFIX = /^[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+)*$/
/** Inline data only for images and fonts. SVG-as-image cannot fetch subresources. */
const ALLOWED_DATA = /^data:(?:image\/[a-z0-9.+-]+|font\/[a-z0-9.+-]+|application\/(?:x-)?font-[a-z0-9.+-]+)[;,]/i
/** In-document fragment references (`filter: url(#blur)`) load nothing. */
const FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_-]*$/
/** A bare file name a teacher may type, resolvable via relativeFiles. */
const RELATIVE_NAME = /^(?:\.\/)?[A-Za-z0-9_][A-Za-z0-9 ._()-]*\.[A-Za-z0-9]+$/

function truncate(s: string) {
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

/**
 * Decide what a decoded URL becomes: the URL to emit, or null to remove it.
 * Exported for tests.
 */
export function resolveAllowedUrl(raw: string, opts: CustomCssOptions = {}): string | null {
  const url = raw.trim()
  if (!url) return null
  // Control chars / whitespace / backslashes never appear in the URLs we
  // allow; rejecting them up front rules out parser-differential tricks
  // (`/\host`, tab-split schemes, …).
  if (/[\u0000- \u007f\\"'<>]/.test(url)) {
    // data: URIs may legitimately contain quotes/spaces in SVG payloads;
    // they are checked separately below.
    if (!ALLOWED_DATA.test(url)) return null
  }
  if (ALLOWED_DATA.test(url)) return url
  if (FRAGMENT.test(url)) return url
  if (ALLOWED_ROOT_PATHS.test(url) && !/(?:^|\/)\.\.?(?:\/|$)/.test(url)) return url
  for (const prefix of opts.allowedUrlPrefixes ?? []) {
    if (prefix && url.startsWith(prefix)) {
      const rest = url.slice(prefix.length)
      if (ALLOWED_SUFFIX.test(rest) && !/(?:^|\/)\.\.?(?:\/|$)/.test(rest)) return url
    }
  }
  if (opts.relativeFiles && RELATIVE_NAME.test(url)) {
    const name = url.replace(/^\.\//, '')
    const resolved = Object.prototype.hasOwnProperty.call(opts.relativeFiles, name)
      ? opts.relativeFiles[name]
      : undefined
    // The resolved URL must itself pass the absolute/root checks.
    if (resolved && resolved !== url) return resolveAllowedUrl(resolved, { allowedUrlPrefixes: opts.allowedUrlPrefixes })
  }
  return null
}

/** Is `url` a bare relative name (candidate for relativeFiles)? */
export function isRelativeFileName(url: string): boolean {
  return RELATIVE_NAME.test(url.trim())
}

// ---------------------------------------------------------------------------
// Tokenizer helpers (CSS Syntax 3 §4.3)
// ---------------------------------------------------------------------------

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c)
const isNewline = (c: string) => c === '\n' || c === '\r' || c === '\f'
const isWs = (c: string) => c === ' ' || c === '\t' || isNewline(c)
const isNameChar = (c: string) => /^[A-Za-z0-9_-]$/.test(c) || (c !== '' && c.charCodeAt(0) >= 0x80)
/** `\` starts a valid escape unless followed by a newline or EOF. */
const isValidEscape = (s: string, i: number) => s[i] === '\\' && i + 1 < s.length && !isNewline(s[i + 1])

/** Decode one escape at s[i] === '\\'. Returns [decodedChar, nextIndex]. */
function decodeEscape(s: string, i: number): [string, number] {
  let j = i + 1
  if (j >= s.length) return ['�', j]
  if (isHex(s[j])) {
    let hex = ''
    while (j < s.length && hex.length < 6 && isHex(s[j])) hex += s[j++]
    if (j < s.length && isWs(s[j])) {
      // One whitespace (CRLF counts as one) terminates the escape.
      if (s[j] === '\r' && s[j + 1] === '\n') j += 2
      else j += 1
    }
    const cp = parseInt(hex, 16)
    const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
    return [ok ? String.fromCodePoint(cp) : '�', j]
  }
  return [s[j], j + 1]
}

/** Consume a name starting at i. Returns { raw, decoded, end }. */
function consumeName(s: string, i: number) {
  let j = i
  let decoded = ''
  while (j < s.length) {
    if (isNameChar(s[j])) {
      decoded += s[j++]
    } else if (isValidEscape(s, j)) {
      const [ch, next] = decodeEscape(s, j)
      decoded += ch
      j = next
    } else break
  }
  return { raw: s.slice(i, j), decoded, end: j }
}

/** Consume a quoted string starting at the quote s[i]. */
function consumeString(s: string, i: number) {
  const quote = s[i]
  let j = i + 1
  let decoded = ''
  while (j < s.length) {
    const c = s[j]
    if (c === quote) { j++; break }
    if (isNewline(c)) break // bad-string: the browser drops it
    if (c === '\\') {
      if (j + 1 >= s.length) { j++; break }
      if (isNewline(s[j + 1])) { j += s[j + 1] === '\r' && s[j + 2] === '\n' ? 3 : 2; continue }
      const [ch, next] = decodeEscape(s, j)
      decoded += ch
      j = next
      continue
    }
    decoded += c
    j++
  }
  return { raw: s.slice(i, j), decoded, end: j }
}

/** Skip a comment starting at `/*`. */
function commentEnd(s: string, i: number) {
  const end = s.indexOf('*/', i + 2)
  return end === -1 ? s.length : end + 2
}

/**
 * Consume an unquoted url token body starting right after `url(` + any
 * whitespace. Returns the decoded value (null for a bad-url token) and end
 * index (after the closing paren).
 */
function consumeUnquotedUrl(s: string, i: number): { decoded: string | null; end: number } {
  let j = i
  let decoded = ''
  while (j < s.length) {
    const c = s[j]
    if (c === ')') return { decoded, end: j + 1 }
    if (isWs(c)) {
      while (j < s.length && isWs(s[j])) j++
      if (j >= s.length || s[j] === ')') return { decoded, end: Math.min(j + 1, s.length) }
      return { decoded: null, end: skipBadUrl(s, j) }
    }
    if (c === '"' || c === "'" || c === '(' || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) {
      return { decoded: null, end: skipBadUrl(s, j) }
    }
    if (c === '\\') {
      if (isValidEscape(s, j)) {
        const [ch, next] = decodeEscape(s, j)
        decoded += ch
        j = next
        continue
      }
      return { decoded: null, end: skipBadUrl(s, j) }
    }
    decoded += c
    j++
  }
  return { decoded, end: j } // EOF: the browser still treats it as a url token
}

/** Bad-url remnants: consume up to and including the next `)` (escapes skipped). */
function skipBadUrl(s: string, i: number) {
  let j = i
  while (j < s.length) {
    if (s[j] === ')') return j + 1
    if (isValidEscape(s, j)) { j = decodeEscape(s, j)[1]; continue }
    j++
  }
  return j
}

/**
 * Skip a balanced region starting at s[i] === '(' or '{' — strings and
 * comments respected. Returns the index after the matching closer.
 */
function skipBalanced(s: string, i: number) {
  const stack: string[] = []
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === '/' && s[j + 1] === '*') { j = commentEnd(s, j); continue }
    if (c === '"' || c === "'") { j = consumeString(s, j).end; continue }
    if (c === '\\') { j = isValidEscape(s, j) ? decodeEscape(s, j)[1] : j + 1; continue }
    if (c === '(' || c === '{' || c === '[') stack.push(c === '(' ? ')' : c === '{' ? '}' : ']')
    else if (c === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return j + 1
    }
    j++
  }
  return j
}

/** End of an at-rule prelude: after the `;`, or after its `{…}` block. */
function atRuleEnd(s: string, i: number) {
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === ';') return j + 1
    if (c === '{') return skipBalanced(s, j)
    if (c === '}') return j // end of the enclosing block; leave it
    if (c === '(' || c === '[') { j = skipBalanced(s, j); continue }
    if (c === '/' && s[j + 1] === '*') { j = commentEnd(s, j); continue }
    if (c === '"' || c === "'") { j = consumeString(s, j).end; continue }
    if (c === '\\') { j = isValidEscape(s, j) ? decodeEscape(s, j)[1] : j + 1; continue }
    j++
  }
  return j
}

/** Functions whose STRING arguments are URLs (CSS Images 4, CSS Values 4 `src()`). */
const URL_STRING_FUNCTIONS = new Set(['src', 'image-set', '-webkit-image-set', 'image'])

/** Escape `<` so the output can never close the <style> element. */
function escapeLt(s: string) {
  return s.replace(/</g, '\\3c ')
}

/**
 * Emit a kept URL as a quoted CSS string. Only data: URIs can contain `"`,
 * `\`, newlines or `<`; those become hex escapes (same characters to CSS,
 * and `<` can no longer close the <style> element).
 */
function quoteUrl(url: string) {
  return `"${url.replace(/["\\\n\r\f<]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`
}

export function sanitizeCustomCss(input: string, opts: CustomCssOptions = {}): SanitizedCss {
  const s = input.replace(/\u0000/g, '�')
  const removed: RemovedCssItem[] = []
  let out = ''
  let i = 0
  // Paren frames: true when the frame belongs to a URL-string function.
  const frames: boolean[] = []
  const inUrlStringFunction = () => frames.some(Boolean)

  const removeUrl = (value: string) => {
    removed.push({ kind: 'url', value: truncate(value), ...(isRelativeFileName(value) ? { relative: true } : {}) })
  }

  while (i < s.length) {
    const c = s[i]

    if (c === '/' && s[i + 1] === '*') {
      const end = commentEnd(s, i)
      out += escapeLt(s.slice(i, end))
      i = end
      continue
    }

    if (c === '"' || c === "'") {
      const str = consumeString(s, i)
      if (inUrlStringFunction()) {
        const ok = resolveAllowedUrl(str.decoded, opts)
        if (ok) out += quoteUrl(ok)
        else { removeUrl(str.decoded); out += 'none' }
      } else {
        out += escapeLt(str.raw)
      }
      i = str.end
      continue
    }

    if (c === '@' && i + 1 < s.length && (isNameChar(s[i + 1]) || isValidEscape(s, i + 1))) {
      const name = consumeName(s, i + 1)
      if (name.decoded.toLowerCase() === 'import') {
        const end = atRuleEnd(s, name.end)
        removed.push({ kind: 'import', value: truncate(s.slice(i, end).trim()) })
        i = end
        continue
      }
      out += escapeLt('@' + name.raw)
      i = name.end
      continue
    }

    if (isNameChar(c) || isValidEscape(s, i)) {
      const name = consumeName(s, i)
      const lower = name.decoded.toLowerCase()
      if (s[name.end] === '(') {
        if (lower === 'url') {
          let j = name.end + 1
          while (j < s.length && isWs(s[j])) j++
          if (s[j] === '"' || s[j] === "'") {
            // url( "…" ) is a function token with a string argument; any
            // trailing url modifiers are dropped along with it.
            const str = consumeString(s, j)
            const end = skipBalanced(s, name.end)
            const ok = resolveAllowedUrl(str.decoded, opts)
            if (ok) out += `url(${quoteUrl(ok)})`
            else { removeUrl(str.decoded); out += 'none' }
            i = end
          } else {
            const tok = consumeUnquotedUrl(s, j)
            const ok = tok.decoded === null ? null : resolveAllowedUrl(tok.decoded, opts)
            if (ok) out += `url(${quoteUrl(ok)})`
            else { removeUrl(tok.decoded ?? s.slice(i, tok.end)); out += 'none' }
            i = tok.end
          }
          continue
        }
        out += escapeLt(name.raw) + '('
        frames.push(URL_STRING_FUNCTIONS.has(lower))
        i = name.end + 1
        continue
      }
      out += escapeLt(name.raw)
      i = name.end
      continue
    }

    if (c === '(') { frames.push(false); out += c; i++; continue }
    if (c === ')') { frames.pop(); out += c; i++; continue }
    if (c === '<') { out += '\\3c '; i++; continue }
    if (c === '\\') { out += c; i++; continue } // invalid escape (before newline/EOF)

    out += c
    i++
  }

  return { css: out, removed }
}
