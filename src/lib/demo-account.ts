/**
 * Identity of the public demo account.
 *
 * Its own module because src/proxy.ts (edge runtime) needs these, and
 * src/lib/seed-demo-content.ts — where the reset lives — reads the filesystem
 * and cannot be imported there.
 */

export const DEMO_EMAIL = 'demo@eduskript.org'
export const DEMO_PASSWORD = 'demodemo'
export const DEMO_SITE_SLUG = 'demo'
