/**
 * Mail-hook parser registry — the pluggable seam.
 *
 * A parser turns a raw inbound email into a small `extracted` JSON object (or
 * null if nothing matched). Each MailHook.mode maps to one parser. Adding a
 * future mode (file-drop, post-by-email, …) is one entry here plus a surface —
 * the receive/route/store spine never changes.
 */

/** Minimal shape a parser sees — a subset of the CloudMailin payload. */
export interface RawMail {
  html?: string
  plain?: string
  subject?: string
  from: string
}

export type Parser = (
  mail: RawMail,
  config: unknown
) => Record<string, unknown> | null

/**
 * Default Udemy login-code pattern: a 6-digit number inside an <h1> (allowing
 * nested/wrapping tags). Lifted from the old Informatikgarten handler.
 */
export const DEFAULT_CODE_REGEX = /<h1[^>]*>(?:<[^>]*>)*(\d{6})(?:<[^>]*>)*<\/h1>/i

/** Plain-text fallback when there's no HTML body: first standalone 6-digit run. */
const PLAIN_CODE_REGEX = /\b(\d{6})\b/

/**
 * Extract a login code. Prefers the (optional) per-hook regex override against
 * the HTML body, then the default HTML pattern, then a plain-text fallback.
 * A malformed override is ignored (falls back to the default) rather than
 * throwing — author input must never 500 the webhook.
 */
export function extractCode(
  html?: string,
  plain?: string,
  regexOverride?: string
): string | null {
  if (html && regexOverride) {
    try {
      const m = html.match(new RegExp(regexOverride, 'i'))
      if (m?.[1]) return m[1]
    } catch {
      // bad override → fall through to defaults
    }
  }
  if (html) {
    const m = html.match(DEFAULT_CODE_REGEX)
    if (m?.[1]) return m[1]
  }
  if (plain) {
    const m = plain.match(PLAIN_CODE_REGEX)
    if (m?.[1]) return m[1]
  }
  return null
}

const loginCodeParser: Parser = (mail, config) => {
  const regex =
    config && typeof config === 'object' && 'regex' in config
      ? String((config as { regex?: unknown }).regex ?? '')
      : undefined
  const code = extractCode(mail.html, mail.plain, regex || undefined)
  return code ? { code } : null
}

export const PARSERS: Record<string, Parser> = {
  'login-code': loginCodeParser,
}
