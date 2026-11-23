/**
 * Class invite codes (/join/<code>). New codes are short and easy to type;
 * classes created before 2026-11 keep their 16-character hex codes until the
 * teacher replaces them (PATCH /api/classes/[id] { shortInviteCode }).
 */

import { randomInt } from 'crypto'

// No 0/o, 1/i/l: codes are read off a projector and typed on phones.
export const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE_LENGTH = 6

/** New class invite code: 6 characters, 31^6 ≈ 890M possibilities. */
export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

/**
 * Invite codes as typed: case-insensitive. All stored codes are lowercase
 * (new 6-char codes and the older 16-char hex ones).
 */
export function normalizeInviteCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

