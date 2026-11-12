import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-ins for the tables email-login touches.
type Token = {
  id: string; pseudonym: string; kind: string; tokenHash: string; classId: string | null
  attempts: number; expiresAt: Date; createdAt: Date
}
const db = vi.hoisted(() => ({
  tokens: [] as Token[],
  optOuts: new Set<string>(),
  users: [] as { id: string; email: string | null; name: string | null; image: string | null; emailVerified: Date | null; studentPseudonym: string | null }[],
  preAuthUpdates: [] as unknown[],
  seq: 0,
}))

function matches(t: Token, where: Record<string, unknown>) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'expiresAt') return t.expiresAt < (v as { lt: Date }).lt
    return (t as unknown as Record<string, unknown>)[k] === v
  })
}

vi.mock('@/lib/prisma', () => {
  const emailLoginToken = {
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = db.tokens.length
      db.tokens = db.tokens.filter((t) => !matches(t, where))
      return { count: before - db.tokens.length }
    }),
    create: vi.fn(async ({ data }: { data: Partial<Token> }) => {
      const row = { id: `t${++db.seq}`, classId: null, attempts: 0, createdAt: new Date(Date.now() + db.seq), ...data } as Token
      db.tokens.push(row)
      return row
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      db.tokens.filter((t) => matches(t, where)).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null),
    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
      db.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => {
      const row = db.tokens.find((t) => t.id === where.id)!
      row.attempts += data.attempts.increment
      return row
    }),
  }
  const client = {
    emailLoginToken,
    inviteOptOut: {
      findMany: vi.fn(async ({ where }: { where: { pseudonym: { in: string[] } } }) =>
        where.pseudonym.in.filter((p) => db.optOuts.has(p)).map((pseudonym) => ({ pseudonym }))),
      upsert: vi.fn(async ({ create }: { create: { pseudonym: string } }) => { db.optOuts.add(create.pseudonym); return create }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email?: { equals: string }; studentPseudonym?: string } }) => {
        if (where.email) return db.users.find((u) => u.email?.toLowerCase() === where.email!.equals.toLowerCase()) ?? null
        return db.users.find((u) => u.studentPseudonym === where.studentPseudonym) ?? null
      }),
      update: vi.fn(async () => ({})),
    },
    class: {
      findUnique: vi.fn(async () => ({
        id: 'class1', name: 'Klasse 3a', inviteCode: 'INV123', isActive: true, archivedAt: null, teacher: { name: 'Frau Muster' },
      })),
    },
    preAuthorizedStudent: {
      updateMany: vi.fn(async (args: unknown) => { db.preAuthUpdates.push(args); return { count: 1 } }),
    },
  }
  return { prisma: client, prismaBase: client }
})

const sentMails = vi.hoisted(() => [] as { to: string | string[]; subject: string; htmlContent: string; textContent?: string }[])
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (mail: (typeof sentMails)[number]) => { sentMails.push(mail) }),
}))

vi.mock('@/lib/privacy-adapter', () => ({
  createStudentUser: vi.fn(async (_p: unknown, pseudonym: string) => {
    const user = { id: `student${++db.seq}`, email: null, name: 'Seneca', image: null, emailVerified: null, studentPseudonym: pseudonym }
    db.users.push(user)
    return user
  }),
  PrivacyAdapter: vi.fn(() => ({
    createUser: vi.fn(async (u: { email: string }) => {
      const user = { id: `teacher${++db.seq}`, email: u.email, name: null, image: null, emailVerified: new Date(), studentPseudonym: null }
      db.users.push(user)
      return user
    }),
  })),
}))

vi.mock('@/lib/signup-context', () => ({
  parseSignupContext: vi.fn(async (raw: string) =>
    ({ isStudent: !(raw === 'teacher-signup' || raw.startsWith('teacher-org:')) })),
}))

process.env.STUDENT_PSEUDONYM_SECRET = 'test-secret-for-email-login-0123456789abcdef'

import {
  requestLoginCode, checkLoginCode, loginWithCode, sendClassInvites, findInvite,
  loginWithInvite, optOutViaInvite, sanitizeSignupContext, normalizeEmail, MAX_CODE_ATTEMPTS,
} from '@/lib/email-login'
import { createStudentUser } from '@/lib/privacy-adapter'
import { generatePseudonym } from '@/lib/privacy/pseudonym'

const STUDENT = 'Anna.Student@School.ch'
const student = STUDENT.toLowerCase()

function lastCode(): string {
  const mail = sentMails[sentMails.length - 1]
  return mail.textContent!.match(/\b(\d{6})\b/)![1]
}

function lastInviteToken(): string {
  return sentMails[sentMails.length - 1].textContent!.match(/\/auth\/invite\/([\w-]+)/)![1]
}

/** Nothing persisted may contain the plaintext address. */
function expectNoAddressStored(email: string) {
  const persisted = JSON.stringify({ tokens: db.tokens, optOuts: [...db.optOuts], updates: db.preAuthUpdates })
  expect(persisted.toLowerCase()).not.toContain(email.toLowerCase())
}

beforeEach(() => {
  db.tokens = []
  db.optOuts = new Set()
  db.users = []
  db.preAuthUpdates = []
  sentMails.length = 0
  vi.clearAllMocks()
})

describe('normalizeEmail / sanitizeSignupContext', () => {
  it('normalizes and rejects invalid addresses', () => {
    expect(normalizeEmail('  Foo@Bar.CH ')).toBe('foo@bar.ch')
    expect(normalizeEmail('nope')).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })

  it('only passes the explicit context formats', () => {
    expect(sanitizeSignupContext('student:muster')).toBe('student:muster')
    expect(sanitizeSignupContext('teacher-org:eduskript')).toBe('teacher-org:eduskript')
    expect(sanitizeSignupContext('teacher-signup')).toBe('teacher-signup')
    // Legacy plain slugs could resolve to a teacher account; not accepted here.
    expect(sanitizeSignupContext('some-slug')).toBe('')
    expect(sanitizeSignupContext('org:x')).toBe('')
  })
})

describe('login codes', () => {
  it('mails a 6-digit code and stores only the pseudonym and a hash', async () => {
    await requestLoginCode(student)
    expect(sentMails).toHaveLength(1)
    expect(sentMails[0].to).toBe(student)
    expect(db.tokens).toHaveLength(1)
    expect(db.tokens[0].pseudonym).toBe(generatePseudonym(student))
    expect(JSON.stringify(db.tokens)).not.toContain(lastCode())
    expectNoAddressStored(student)
  })

  it('accepts the right code and counts wrong guesses', async () => {
    await requestLoginCode(student)
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    expect((await checkLoginCode(student, wrong)).result).toBe('invalid')
    expect(db.tokens[0].attempts).toBe(1)
    expect((await checkLoginCode(student, code)).result).toBe('ok')
  })

  it('locks after too many wrong guesses, even for the right code', async () => {
    await requestLoginCode(student)
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await checkLoginCode(student, wrong)
    expect((await checkLoginCode(student, code)).result).toBe('locked')
  })

  it('rejects an expired code', async () => {
    await requestLoginCode(student)
    db.tokens[0].expiresAt = new Date(Date.now() - 1000)
    expect((await checkLoginCode(student, lastCode())).result).toBe('expired')
  })

  it('a new request replaces the old code', async () => {
    await requestLoginCode(student)
    const first = lastCode()
    await requestLoginCode(student)
    expect(db.tokens).toHaveLength(1)
    if (first !== lastCode()) expect((await checkLoginCode(student, first)).result).toBe('invalid')
  })
})

describe('loginWithCode account resolution', () => {
  it('creates a student with only the pseudonym and consumes the code', async () => {
    await requestLoginCode(student)
    const user = await loginWithCode(student, lastCode(), 'student:muster')
    expect(createStudentUser).toHaveBeenCalledWith(expect.anything(), generatePseudonym(student), expect.objectContaining({ isStudent: true }))
    expect(db.users[0].email).toBeNull()
    expect(user.email).toBe(student) // JWT only (oauthEmail), not the DB
    expect(db.tokens).toHaveLength(0)
    expectNoAddressStored(student)
  })

  it('logs an existing student in by pseudonym, whatever the page context', async () => {
    db.users.push({ id: 's1', email: null, name: 'Zeno', image: null, emailVerified: null, studentPseudonym: generatePseudonym(student) })
    await requestLoginCode(student)
    const user = await loginWithCode(student, lastCode(), 'teacher-signup')
    expect(user.id).toBe('s1')
    expect(createStudentUser).not.toHaveBeenCalled()
  })

  it('logs a teacher in by stored email (case-insensitive)', async () => {
    db.users.push({ id: 'te1', email: 'teacher@school.ch', name: 'T', image: null, emailVerified: new Date(), studentPseudonym: null })
    await requestLoginCode('teacher@school.ch')
    const user = await loginWithCode('teacher@school.ch', lastCode(), 'student:muster')
    expect(user.id).toBe('te1')
  })

  it('creates a teacher (with email) from a teacher context', async () => {
    await requestLoginCode('new.teacher@school.ch')
    const user = await loginWithCode('new.teacher@school.ch', lastCode(), 'teacher-signup')
    expect(user.id).toMatch(/^teacher/)
    expect(db.users[0].email).toBe('new.teacher@school.ch')
  })

  it('throws on a wrong code without creating an account', async () => {
    await requestLoginCode(student)
    const wrong = lastCode() === '000000' ? '111111' : '000000'
    await expect(loginWithCode(student, wrong, 'student:muster')).rejects.toThrow('EMAIL_CODE_INVALID')
    expect(db.users).toHaveLength(0)
  })
})

describe('class invites', () => {
  const recipient = { email: student, pseudonym: generatePseudonym(student) }
  const send = (allow = () => true, recipients = [recipient], className = 'Klasse 3a') =>
    sendClassInvites({ classId: 'class1', className, teacherName: 'Frau Muster', recipients, allow })

  it('mails a join link, stores only pseudonym + hash, marks invitedAt', async () => {
    const result = await send()
    expect(result.sent).toEqual([student])
    expect(sentMails[0].htmlContent).toContain('Frau Muster')
    expect(db.tokens[0]).toMatchObject({ kind: 'invite', classId: 'class1', pseudonym: recipient.pseudonym })
    expect(JSON.stringify(db.tokens)).not.toContain(lastInviteToken())
    expect(db.preAuthUpdates).toHaveLength(1)
    expectNoAddressStored(student)
  })

  it('escapes teacher-chosen class names and breaks autolinks', async () => {
    await send(undefined, undefined, '<a href="x">evil.example</a>')
    const html = sentMails[0].htmlContent
    expect(html).not.toContain('<a href="x">')
    expect(html).not.toContain('evil.example')
  })

  it('skips opted-out recipients and respects the rate limit', async () => {
    db.optOuts.add(recipient.pseudonym)
    expect((await send()).optedOut).toBe(1)
    db.optOuts.clear()
    expect((await send(() => false)).limited).toBe(1)
    expect(sentMails).toHaveLength(0)
  })

  it('page view does not consume the link; login does, once', async () => {
    await send()
    const token = lastInviteToken()
    expect(await findInvite(token)).not.toBeNull()
    expect(await findInvite(token)).not.toBeNull()
    const user = await loginWithInvite(token)
    expect(user.inviteCode).toBe('INV123')
    expect(db.users[0].studentPseudonym).toBe(recipient.pseudonym)
    await expect(loginWithInvite(token)).rejects.toThrow('INVITE_INVALID')
  })

  it('invite login finds an existing student instead of creating one', async () => {
    db.users.push({ id: 's1', email: null, name: 'Zeno', image: null, emailVerified: null, studentPseudonym: recipient.pseudonym })
    await send()
    expect((await loginWithInvite(lastInviteToken())).id).toBe('s1')
    expect(createStudentUser).not.toHaveBeenCalled()
  })

  it('a resend replaces the earlier link', async () => {
    await send()
    const first = lastInviteToken()
    await send()
    expect(await findInvite(first)).toBeNull()
    expect(await findInvite(lastInviteToken())).not.toBeNull()
  })

  it('opt-out blocks future invites and removes open links', async () => {
    await send()
    expect(await optOutViaInvite(lastInviteToken())).toBe(true)
    expect(db.optOuts.has(recipient.pseudonym)).toBe(true)
    expect(db.tokens).toHaveLength(0)
  })
})
