/**
 * Turns a stored product-update draft into the mail one recipient gets:
 * the body exactly as written in Thunderbird plus a one-line unsubscribe
 * footer in the recipient's language. Also builds the RFC 8058 headers.
 *
 * Known limitations: inline images (cid:) and attachments of the original
 * mail are not carried over — only the HTML/text bodies are stored. Remote
 * <img src="https://…"> works.
 */

export type MailLanguage = 'de' | 'en'

export interface DraftContent {
  subject: string
  bodyHtml: string | null
  bodyText: string | null
}

export const PRODUCT_UPDATE_FROM = { name: 'Marc Chéhab', address: 'marc@eduskript.org' }
export const PRODUCT_UPDATE_REPLY_TO = 'marc@eduskript.org'

export function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/** German if any of the teacher's sites is German (same rule the Brevo lists used). */
export function languageForSites(sites: { pageLanguage: string | null }[]): MailLanguage {
  return sites.some((s) => s.pageLanguage?.toLowerCase().startsWith('de')) ? 'de' : 'en'
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function footer(lang: MailLanguage, unsubscribeUrl: string): { html: string; text: string } {
  const url = escapeHtml(unsubscribeUrl)
  const style = 'margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;font-family:Arial,sans-serif;'
  if (lang === 'de') {
    return {
      html: `<p style="${style}">Produkt-Updates von Eduskript. Du kannst dich jederzeit <a href="${url}" style="color:#6b7280;">abmelden</a>.</p>`,
      text: `Produkt-Updates von Eduskript. Du kannst dich jederzeit abmelden: ${unsubscribeUrl}`,
    }
  }
  return {
    html: `<p style="${style}">Eduskript product updates. You can <a href="${url}" style="color:#6b7280;">unsubscribe</a> at any time.</p>`,
    text: `Eduskript product updates. You can unsubscribe at any time: ${unsubscribeUrl}`,
  }
}

/** Insert `fragment` before the last </body>, or append when there is none. */
export function injectBeforeBodyEnd(html: string, fragment: string): string {
  const idx = html.toLowerCase().lastIndexOf('</body>')
  return idx === -1 ? html + fragment : html.slice(0, idx) + fragment + html.slice(idx)
}

/** Insert `fragment` right after the opening <body …> tag, or prepend. */
export function injectAfterBodyStart(html: string, fragment: string): string {
  const m = /<body[^>]*>/i.exec(html)
  return m ? html.slice(0, m.index + m[0].length) + fragment + html.slice(m.index + m[0].length) : fragment + html
}

/** Plain-text body → minimal HTML, for mails that arrive without an HTML part. */
function textToHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;">${escapeHtml(text)}</div>`
}

export function renderProductUpdate(
  draft: DraftContent,
  lang: MailLanguage,
  unsubscribeUrl: string
): { html: string; text: string } {
  const f = footer(lang, unsubscribeUrl)
  const html = draft.bodyHtml || textToHtml(draft.bodyText ?? '')
  const text = (draft.bodyText ?? '').trimEnd()
  return {
    html: injectBeforeBodyEnd(html, f.html),
    text: `${text}\n\n-- \n${f.text}\n`,
  }
}

export function unsubscribePageUrl(token: string): string {
  return `${baseUrl()}/unsubscribe?token=${encodeURIComponent(token)}`
}

/**
 * RFC 2369 + RFC 8058 headers. The POST target is the API route, which accepts
 * the one-click body ("List-Unsubscribe=One-Click") without login.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${baseUrl()}/api/product-updates/unsubscribe?token=${encodeURIComponent(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
