/**
 * Inbound-email hook constants.
 *
 * The spine (receive → route → store → parse → surface) is mode-agnostic; the
 * per-mode defaults live here. Slice 1 ships only "login-code".
 */

/** Code TTL — matches the old Informatikgarten behavior (15 min). */
export const CODE_TTL_MINUTES = 15

/** Default poll interval (ms) for the <login-codes> surface. */
export const DEFAULT_POLL_INTERVAL_MS = 4000

/** Modes a MailHook can run. Slice 1 = login-code only. */
export const MAIL_HOOK_MODES = ['login-code'] as const
export type MailHookMode = (typeof MAIL_HOOK_MODES)[number]

/** Default retention per mode. null = persistent (rows kept). */
export const MODE_DEFAULT_TTL_MINUTES: Record<string, number | null> = {
  'login-code': CODE_TTL_MINUTES,
}
