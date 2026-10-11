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
 *      - `@function` rules are removed (custom functions could return a URL
 *        string into image-set()), and `expression(…)` calls are dropped;
 *      - `url(…)` is kept only when it points at Eduskript-served files (see
 *        resolveAllowedUrl); anything else is replaced by `none`, which
 *        makes the declaration invalid or imageless — nothing is fetched;
 *      - `image-set()`, `-webkit-image-set()`, `image()` and `src()` treat
 *        STRINGS as URLs, and a var()/attr()/env()/custom function inside
 *        them could produce such a string at computed-value time. Their
 *        arguments are therefore allowlisted (checked strings, checked
 *        url(), numbers/resolutions, type("…"), simple *-gradient()); any
 *        other token rejects the whole call (→ `none`).
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
 * removes a URL, it never lets one through. Linear in the input length:
 * every helper advances past what it inspects and nothing is re-scanned.
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
  kind: 'import' | 'url' | 'rule'
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
 * (/api/files/<id>, redirects to the teacher-file bucket). No query string,
 * no fragment, no percent-encoding, no dot segments.
 */
const ALLOWED_ROOT_PATHS = /^\/(?:fonts|_next\/static\/media|api\/files)(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/
/** What may follow an allowed absolute prefix (content-addressed keys). */
const ALLOWED_SUFFIX = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*$/
/**
 * Inline data only for raster images and fonts. No SVG: an SVG document is a
 * second parser with its own URL references, so it is not worth the risk.
 */
const ALLOWED_DATA = /^data:(?:image\/(?:png|jpeg|jpg|gif|webp|avif)|font\/[a-z0-9.+-]+|application\/(?:x-)?font-[a-z0-9.+-]+)[;,]/i
/** In-document fragment references (`filter: url(#blur)`) load nothing. */
const FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_-]*$/
/** A bare file name a teacher may type, resolvable via relativeFiles. */
const RELATIVE_NAME = /^(?:\.\/)?[A-Za-z0-9_][A-Za-z0-9 ._()-]*\.[A-Za-z0-9]+$/

function truncate(s: string) {
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

/**
 * True when the browser would resolve `url` to exactly the same path (no
 * normalisation happened). Belt and braces on top of the charset regexes,
 * which already exclude `%`, `\\` and dot segments.
 */
function resolvesToItself(url: string): boolean {
  try {
    const u = new URL(url, 'https://x.invalid')
    const expected = url.startsWith('/') ? `https://x.invalid${url}` : url
    return u.href === expected && !u.search && !u.hash
  } catch {
    return false
  }
}

/**
 * Decide what a decoded URL becomes: the URL to emit, or null to remove it.
 * Exported for tests.
 */
export function resolveAllowedUrl(raw: string, opts: CustomCssOptions = {}): string | null {
  const url = raw.trim()
  if (!url) return null
  if (ALLOWED_DATA.test(url)) return url
  // Everything else: strict charset only — no whitespace/controls, quotes,
  // backslashes, `%` (rules out %2e%2e traversal), `?`, `<`.
  if (!/^[A-Za-z0-9._~\-/:#]+$/.test(url)) {
    return resolveRelative(url, opts)
  }
  if (FRAGMENT.test(url)) return url
  if (ALLOWED_ROOT_PATHS.test(url) && !/\/\.\.?(?:\/|$)/.test(url) && resolvesToItself(url)) return url
  for (const prefix of opts.allowedUrlPrefixes ?? []) {
    if (!prefix || !url.startsWith(prefix)) continue
    const rest = url.slice(prefix.length)
    if (!ALLOWED_SUFFIX.test(rest) || /(?:^|\/)\.\.?(?:\/|$)/.test(rest) || !resolvesToItself(url)) continue
    try {
      // The normalised path must still sit under the prefix's path.
      if (new URL(url).pathname.startsWith(new URL(prefix).pathname)) return url
    } catch { /* not absolute: ignore */ }
  }
  return resolveRelative(url, opts)
}

function resolveRelative(url: string, opts: CustomCssOptions): string | null {
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

/**
 * Bad-url remnants: the browser consumes up to and including the next `)`
 * (escapes skipped). We additionally swallow one directly following `)` per
 * `(` seen inside, so `url(javascript:alert(1))` goes away whole instead of
 * leaving a stray `)`. Removing more than the browser would is safe: dropped
 * text is never emitted.
 */
function skipBadUrl(s: string, i: number) {
  let j = i
  let opens = 0
  while (j < s.length) {
    if (s[j] === ')') {
      j++
      while (opens > 0 && s[j] === ')') { opens--; j++ }
      return j
    }
    if (s[j] === '(') opens++
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

/** A gradient with at most one level of nested parens (rgb(), calc()) and no strings/escapes. */
const SIMPLE_GRADIENT = /^[a-z-]*gradient\((?:[^()"'\\<@]|\([^()"'\\<@]*\))*\)$/i
const TYPE_FN = /^type\(\s*(?:"[a-z0-9/+.-]*"|'[a-z0-9/+.-]*')\s*\)$/i
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)?/i

/**
 * Sanitize the argument list of a URL-string function (image-set etc.).
 * `inner` is the text between the parens. Returns the safe argument text,
 * or null to reject the whole call. Allowed: whitespace, commas, comments,
 * strings and url() that pass resolveAllowedUrl, numbers/resolutions
 * (`1x`, `2dppx`), type("image/png"), simple *-gradient(). Anything else
 * (var(), attr(), env(), --custom(), brackets, bare idents) can yield a URL
 * string at computed-value time, so it rejects the call.
 */
function sanitizeUrlStringArgs(inner: string, opts: CustomCssOptions): string | null {
  let out = ''
  let i = 0
  while (i < inner.length) {
    const c = inner[i]
    if (isWs(c) || c === ',') { out += c; i++; continue }
    if (c === '/' && inner[i + 1] === '*') { i = commentEnd(inner, i); out += ' '; continue }
    if (c === '"' || c === "'") {
      const str = consumeString(inner, i)
      const ok = resolveAllowedUrl(str.decoded, opts)
      if (!ok) return null
      out += quoteUrl(ok)
      i = str.end
      continue
    }
    const num = NUMBER.exec(inner.slice(i, i + 64))
    if (num && /[0-9.]/.test(c + (inner[i + 1] ?? ''))) { out += num[0]; i += num[0].length; continue }
    if (isNameChar(c) || isValidEscape(inner, i)) {
      const name = consumeName(inner, i)
      if (inner[name.end] !== '(') return null
      const lower = name.decoded.toLowerCase()
      const end = skipBalanced(inner, name.end)
      const call = inner.slice(i, end)
      if (lower === 'url') {
        let j = name.end + 1
        while (j < inner.length && isWs(inner[j])) j++
        const value = inner[j] === '"' || inner[j] === "'"
          ? consumeString(inner, j).decoded
          : consumeUnquotedUrl(inner, j).decoded
        const ok = value === null ? null : resolveAllowedUrl(value, opts)
        if (!ok) return null
        out += `url(${quoteUrl(ok)})`
      } else if (lower === 'type' && TYPE_FN.test(call)) {
        out += call
      } else if (lower.endsWith('gradient') && SIMPLE_GRADIENT.test(call)) {
        out += call
      } else {
        return null
      }
      i = end
      continue
    }
    return null
  }
  return out
}

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
      out += escapeLt(str.raw)
      i = str.end
      continue
    }

    if (c === '@' && i + 1 < s.length && (isNameChar(s[i + 1]) || isValidEscape(s, i + 1))) {
      const name = consumeName(s, i + 1)
      const at = name.decoded.toLowerCase()
      if (at === 'import' || at === 'function') {
        const end = atRuleEnd(s, name.end)
        removed.push({ kind: at === 'import' ? 'import' : 'rule', value: truncate(s.slice(i, end).trim()) })
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
        if (URL_STRING_FUNCTIONS.has(lower) || lower === 'expression') {
          // Whole call at once: balanced end (strings/comments/brackets
          // respected, same nesting the browser uses), then allowlist.
          const end = skipBalanced(s, name.end)
          const close = s[end - 1] === ')' && end > name.end + 1
          const inner = s.slice(name.end + 1, close ? end - 1 : end)
          const args = lower === 'expression' ? null : sanitizeUrlStringArgs(inner, opts)
          if (args === null) {
            removed.push({ kind: 'url', value: truncate(s.slice(i, end)) })
            out += 'none'
          } else {
            out += `${escapeLt(name.raw)}(${args})`
          }
          i = end
          continue
        }
        out += escapeLt(name.raw) + '('
        i = name.end + 1
        continue
      }
      out += escapeLt(name.raw)
      i = name.end
      continue
    }

    if (c === '<') { out += '\\3c '; i++; continue }
    if (c === '\\') { out += c; i++; continue } // invalid escape (before newline/EOF)

    out += c
    i++
  }

  return { css: out, removed }
}
