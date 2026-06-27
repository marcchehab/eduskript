/**
 * Sub-address token helpers for inbound-email routing.
 *
 * Routing model: one shared platform CloudMailin address. Each MailHook gets an
 * unguessable token used as a sub-address tag — the teacher forwards their
 * generic account's mail to `inbox+<token>@…cloudmailin.net`. The webhook reads
 * the token from the delivered `to` and looks up the hook. No per-user
 * CloudMailin credentials needed.
 */

import { randomBytes } from 'crypto'

/** Generate an unguessable, URL/email-safe token (24 hex chars = 96 bits). */
export function generateToken(): string {
  return randomBytes(12).toString('hex')
}

/**
 * Extract the sub-address tag from an email address.
 * `inbox+abc123@cloudmailin.net` → `abc123`. Returns null if no `+tag`.
 *
 * NOTE: depends on CloudMailin preserving plus-addressing in the delivered
 * `to`. If it doesn't, the webhook falls back to MailHook.sourceEmail matching.
 */
export function parseSubAddressToken(to: string | undefined | null): string | null {
  if (!to) return null
  const match = to.match(/\+([^@>\s]+)@/)
  return match ? match[1] : null
}

/** Build the forwarding sub-address shown in settings (for a given token). */
export function buildSubAddress(base: string, token: string): string | null {
  // base e.g. "inbox@xxxx.cloudmailin.net" → "inbox+<token>@xxxx.cloudmailin.net"
  const at = base.indexOf('@')
  if (at < 1) return null
  return `${base.slice(0, at)}+${token}${base.slice(at)}`
}
