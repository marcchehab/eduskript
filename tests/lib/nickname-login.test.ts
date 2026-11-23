/**
 * Nickname students (src/lib/nickname-login.ts) and short invite codes
 * (src/lib/invite-code.ts). Prisma is mocked; the rate limiters are real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = { user: { create: vi.fn() }, classMembership: { create: vi.fn() } }
  return {
    tx,
    prisma: {
      class: { findUnique: vi.fn() },
      user: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
// Cost 4 instead of 12: the rate-limit test signs up 60 times.
vi.mock('bcryptjs', async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import('bcryptjs') }>()).default
  return { default: { ...real, hash: (pw: string) => real.hash(pw, 4) } }
})
vi.mock('@/lib/privacy/pseudonym', () => ({ generatePseudonym: (s: string) => `pseudo-${s.length}` }))

import {
  cleanNickname, signUpWithNickname, signInWithNickname, resetNicknamePassword,
  nicknameSignupRateLimiter, nicknameLoginRateLimiter, MAX_NICKNAME_STUDENTS_PER_CLASS,
} from '@/lib/nickname-login'
import { generateInviteCode, normalizeInviteCode } from '@/lib/invite-code'

const openClass = {
  id: 'class-1', inviteCode: 'k7mpqx', isActive: true, archivedAt: null, isImplicit: false,
  teacherId: 'teacher-1', allowAnonymous: true, nicknameLogin: true,
}

let ipCounter = 0
const signUp = (over: Record<string, unknown> = {}) =>
  signUpWithNickname({ code: 'K7MPQX', nickname: 'Blitz 42', password: 'secret1', ip: `ip-${++ipCounter}`, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.class.findUnique.mockResolvedValue(openClass)
  mocks.prisma.user.count.mockResolvedValue(0)
  mocks.tx.user.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: 'user-1', name: data.name }))
  mocks.prisma.$transaction.mockImplementation(async (fn: (t: typeof mocks.tx) => unknown) => fn(mocks.tx))
})

describe('invite codes', () => {
  it('are 6 characters without look-alikes', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz2-9]{6}$/)
  })
  it('are matched case-insensitively, trimmed', () => {
    expect(normalizeInviteCode(' K7MpQX ')).toBe('k7mpqx')
    expect(normalizeInviteCode(undefined)).toBe('')
  })
})

describe('cleanNickname', () => {
  it('accepts letters, digits, space, - and _; collapses spaces', () => {
    expect(cleanNickname('  Blitz   42 ')).toBe('Blitz 42')
    expect(cleanNickname('Zoë_x-1')).toBe('Zoë_x-1')
  })
  it('rejects too short/long, email addresses and other characters', () => {
    expect(cleanNickname('a')).toBeNull()
    expect(cleanNickname('a'.repeat(25))).toBeNull()
    expect(cleanNickname('anna@school.ch')).toBeNull()
    expect(cleanNickname('<b>x</b>')).toBeNull()
    expect(cleanNickname(42)).toBeNull()
  })
})

describe('signUpWithNickname', () => {
  it('creates a student without email, enrolled in the class', async () => {
    const user = await signUp()
    expect(user).toEqual({ id: 'user-1', name: 'Blitz 42' })
    expect(mocks.prisma.class.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { inviteCode: 'k7mpqx' } }))
    const data = mocks.tx.user.create.mock.calls[0][0].data
    expect(data).toMatchObject({ name: 'Blitz 42', nickname: 'blitz 42', nicknameClassId: 'class-1', accountType: 'student' })
    expect(data.email).toBeUndefined()
    expect(await bcrypt.compare('secret1', data.hashedPassword)).toBe(true)
    expect(mocks.tx.classMembership.create).toHaveBeenCalledWith({ data: { classId: 'class-1', studentId: 'user-1' } })
  })

  it('rejects invalid nickname and short password before touching the DB', async () => {
    await expect(signUp({ nickname: 'x@y.ch' })).rejects.toThrow('NICKNAME_INVALID')
    await expect(signUp({ password: '12345' })).rejects.toThrow('PASSWORD_INVALID')
    expect(mocks.prisma.class.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    ['nickname login off', { nicknameLogin: false }],
    ['not anonymous', { allowAnonymous: false }],
    ['archived', { archivedAt: new Date() }],
    ['inactive', { isActive: false }],
    ['implicit survey class', { isImplicit: true }],
  ])('refuses when the class is %s', async (_label, over) => {
    mocks.prisma.class.findUnique.mockResolvedValue({ ...openClass, ...over })
    await expect(signUp()).rejects.toThrow('CLASS_UNAVAILABLE')
  })

  it('refuses when the class is full', async () => {
    mocks.prisma.user.count.mockResolvedValue(MAX_NICKNAME_STUDENTS_PER_CLASS)
    await expect(signUp()).rejects.toThrow('CLASS_FULL')
  })

  it('maps a unique violation to NICKNAME_TAKEN', async () => {
    mocks.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
    )
    await expect(signUp()).rejects.toThrow('NICKNAME_TAKEN')
  })

  it('rate-limits per class + IP', async () => {
    nicknameSignupRateLimiter.reset('class-1:same-ip')
    for (let i = 0; i < 60; i++) await signUp({ ip: 'same-ip' })
    await expect(signUp({ ip: 'same-ip' })).rejects.toThrow('RATE_LIMITED')
    await expect(signUp({ ip: 'other-ip' })).resolves.toBeTruthy()
  })
})

describe('signInWithNickname', () => {
  const hash = bcrypt.hashSync('secret1', 4)
  beforeEach(() => {
    nicknameLoginRateLimiter.reset('class-1:blitz 42')
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Blitz 42', hashedPassword: hash })
  })

  it('signs in with code + nickname (any case) + password', async () => {
    await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'BLITZ 42', password: 'secret1' }))
      .resolves.toEqual({ id: 'user-1', name: 'Blitz 42' })
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { nicknameClassId_nickname: { nicknameClassId: 'class-1', nickname: 'blitz 42' } },
    }))
  })

  it('rejects a wrong password or unknown nickname the same way', async () => {
    await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'Blitz 42', password: 'nope' })).rejects.toThrow('INVALID_CREDENTIALS')
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'Other', password: 'secret1' })).rejects.toThrow('INVALID_CREDENTIALS')
  })

  it('refuses sign-in once the class is archived', async () => {
    mocks.prisma.class.findUnique.mockResolvedValue({ ...openClass, archivedAt: new Date() })
    await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'Blitz 42', password: 'secret1' })).rejects.toThrow('CLASS_UNAVAILABLE')
  })

  it('locks a nickname after 10 attempts, from any IP', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'Blitz 42', password: 'nope' })).rejects.toThrow('INVALID_CREDENTIALS')
    }
    await expect(signInWithNickname({ code: 'k7mpqx', nickname: 'Blitz 42', password: 'secret1' })).rejects.toThrow('RATE_LIMITED')
  })
})

describe('resetNicknamePassword', () => {
  it('stores the hash of the returned password', async () => {
    const pw = await resetNicknamePassword('user-1')
    expect(pw).toMatch(/^[a-z2-9]{8}$/)
    const { hashedPassword } = mocks.prisma.user.update.mock.calls[0][0].data
    expect(await bcrypt.compare(pw, hashedPassword)).toBe(true)
  })
})
