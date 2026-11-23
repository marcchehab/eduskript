/**
 * Nickname students: accounts without email for classes with `nicknameLogin`
 * (workshops, substitute lessons). The student opens /join/<code>, picks a
 * nickname + password, and can sign in again from any device with the same
 * three things. Their work is stored on the server like any student's.
 *
 * - Account: a normal `accountType:'student'` User with `nicknameClassId` +
 *   `nickname` (lowercased, unique per class; typed spelling in `name`) and a
 *   bcrypt hash in `hashedPassword`. No email. Deleting the class deletes the
 *   account (FK cascade); archiving it only blocks sign-in (classForNickname).
 * - Sign-in: the 'nickname' credentials provider in src/lib/auth.ts calls
 *   signUpWithNickname / signInWithNickname.
 * - Teacher: password reset + removal in the class view
 *   (src/app/api/classes/[id]/students/[studentId]/).
 *
 * Rate limits are in-process (src/lib/rate-limit.ts), so they hold per app
 * instance only. They are keyed by class code, not IP alone: a school class
 * shares one IP behind NAT.
 */

import bcrypt from 'bcryptjs'
import { randomBytes, randomInt } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { RateLimiter } from '@/lib/rate-limit'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { CODE_ALPHABET, normalizeInviteCode } from '@/lib/invite-code'

export const MAX_NICKNAME_STUDENTS_PER_CLASS = 1000
export const PASSWORD_MIN = 6
// bcrypt ignores bytes after 72.
const PASSWORD_MAX = 72

/** Account creation: per class code + IP (a whole class may share one IP). */
export const nicknameSignupRateLimiter = new RateLimiter('nickname-signup', {
  interval: 10 * 60 * 1000,
  maxRequests: 60,
})
/** Password guessing: per class code + nickname, whatever the IP. */
export const nicknameLoginRateLimiter = new RateLimiter('nickname-login', {
  interval: 15 * 60 * 1000,
  maxRequests: 10,
})

export type NicknameError =
  | 'NICKNAME_INVALID'
  | 'PASSWORD_INVALID'
  | 'CLASS_UNAVAILABLE'
  | 'NICKNAME_TAKEN'
  | 'CLASS_FULL'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'

export class NicknameLoginError extends Error {
  constructor(public code: NicknameError) {
    super(code)
  }
}

/**
 * Trimmed, inner whitespace collapsed; 2–24 letters, digits, space, '-', '_'.
 * Returns null when invalid (this also rules out email addresses: no '@').
 */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const nick = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (nick.length < 2 || nick.length > 24) return null
  return /^[\p{L}\p{N} _-]+$/u.test(nick) ? nick : null
}

const nicknameKey = (nick: string) => nick.toLowerCase()

function validPassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= PASSWORD_MIN && raw.length <= PASSWORD_MAX
}

/** The class behind a code, if it currently accepts nickname sign-up/sign-in. */
async function classForNickname(rawCode: unknown) {
  const inviteCode = normalizeInviteCode(rawCode)
  if (!inviteCode) return null
  const cls = await prisma.class.findUnique({
    where: { inviteCode },
    select: {
      id: true, inviteCode: true, isActive: true, archivedAt: true, isImplicit: true,
      teacherId: true, allowAnonymous: true, nicknameLogin: true,
    },
  })
  if (!cls || !cls.isActive || cls.archivedAt || cls.isImplicit || !cls.teacherId) return null
  if (!cls.nicknameLogin || !cls.allowAnonymous) return null
  return cls
}

export interface NicknameUser {
  id: string
  name: string | null
}

/** Create the account, enrol it in the class. Throws NicknameLoginError. */
export async function signUpWithNickname(input: {
  code: unknown
  nickname: unknown
  password: unknown
  ip: string
}): Promise<NicknameUser> {
  const nick = cleanNickname(input.nickname)
  if (!nick) throw new NicknameLoginError('NICKNAME_INVALID')
  if (!validPassword(input.password)) throw new NicknameLoginError('PASSWORD_INVALID')

  const cls = await classForNickname(input.code)
  if (!cls) throw new NicknameLoginError('CLASS_UNAVAILABLE')
  if (!nicknameSignupRateLimiter.check(`${cls.id}:${input.ip}`).allowed) {
    throw new NicknameLoginError('RATE_LIMITED')
  }

  const count = await prisma.user.count({ where: { nicknameClassId: cls.id } })
  if (count >= MAX_NICKNAME_STUDENTS_PER_CLASS) throw new NicknameLoginError('CLASS_FULL')

  const key = nicknameKey(nick)
  const hashedPassword = await bcrypt.hash(input.password, 12)
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: nick,
          nickname: key,
          nicknameClassId: cls.id,
          hashedPassword,
          accountType: 'student',
          // Code paths that key student data on the pseudonym keep working.
          // Random, not derived from the nickname: a later account with the
          // same nickname (after removal) must not inherit anything.
          studentPseudonym: generatePseudonym(`nickname:${cls.id}:${randomBytes(16).toString('hex')}`),
          lastSeenAt: new Date(),
        },
        select: { id: true, name: true },
      })
      // identityConsent stays false: there is no identity beyond the nickname,
      // which the teacher sees anyway (it is the account name).
      await tx.classMembership.create({ data: { classId: cls.id, studentId: user.id } })
      return user
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new NicknameLoginError('NICKNAME_TAKEN')
    }
    throw error
  }
}

/** Check code + nickname + password. Throws NicknameLoginError. */
export async function signInWithNickname(input: {
  code: unknown
  nickname: unknown
  password: unknown
}): Promise<NicknameUser> {
  const nick = cleanNickname(input.nickname)
  if (!nick || typeof input.password !== 'string') throw new NicknameLoginError('INVALID_CREDENTIALS')

  const cls = await classForNickname(input.code)
  if (!cls) throw new NicknameLoginError('CLASS_UNAVAILABLE')
  const key = nicknameKey(nick)
  if (!nicknameLoginRateLimiter.check(`${cls.id}:${key}`).allowed) {
    throw new NicknameLoginError('RATE_LIMITED')
  }

  const user = await prisma.user.findUnique({
    where: { nicknameClassId_nickname: { nicknameClassId: cls.id, nickname: key } },
    select: { id: true, name: true, hashedPassword: true },
  })
  if (!user?.hashedPassword || !(await bcrypt.compare(input.password, user.hashedPassword))) {
    throw new NicknameLoginError('INVALID_CREDENTIALS')
  }
  nicknameLoginRateLimiter.reset(`${cls.id}:${key}`)
  return { id: user.id, name: user.name }
}

/** Teacher reset: a new random password, returned once in plain text. */
export async function resetNicknamePassword(userId: string): Promise<string> {
  const password = generatePassword()
  await prisma.user.update({
    where: { id: userId },
    data: { hashedPassword: await bcrypt.hash(password, 12) },
  })
  return password
}

/** 8 characters from the invite-code alphabet (readable aloud, no 0/o, 1/l). */
function generatePassword(): string {
  let pw = ''
  for (let i = 0; i < 8; i++) pw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return pw
}
