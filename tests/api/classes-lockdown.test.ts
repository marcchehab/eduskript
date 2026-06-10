import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    class: { findUnique: vi.fn(), update: vi.fn() },
  },
  publish: vi.fn(() => Promise.resolve()),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.mockPrisma }))
vi.mock('@/lib/billing', () => ({
  isPaidUser: () => true,
  paidOnlyResponse: () => new Response('paid', { status: 402 }),
}))
vi.mock('@/lib/events', () => ({ eventBus: { publish: mocks.publish } }))

import { getServerSession } from 'next-auth'
import { PATCH } from '@/app/api/classes/[id]/route'

const mockPrisma = mocks.mockPrisma
const mockSession = getServerSession as unknown as ReturnType<typeof vi.fn>

function patch(body: unknown) {
  return new NextRequest('http://localhost/api/classes/class-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = { params: Promise.resolve({ id: 'class-1' }) }

const updatedClass = (lockdownMode: boolean) => ({
  id: 'class-1',
  name: 'Class 1',
  description: null,
  inviteCode: 'abc',
  allowAnonymous: false,
  lockdownMode,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { memberships: 3, preAuthorizedStudents: 0 },
})

describe('PATCH /api/classes/[id] lockdownMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.mockResolvedValue({ user: { id: 'teacher-1' } })
  })

  it('turning lockdown on updates the class and publishes a reload event', async () => {
    mockPrisma.class.findUnique.mockResolvedValue({ teacherId: 'teacher-1', lockdownMode: false })
    mockPrisma.class.update.mockResolvedValue(updatedClass(true))

    const res = await PATCH(patch({ lockdownMode: true }), ctx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.class.lockdownMode).toBe(true)
    expect(mockPrisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lockdownMode: true } })
    )
    expect(mocks.publish).toHaveBeenCalledWith(
      'lockdown:class-1',
      expect.objectContaining({ type: 'lockdown-change', classId: 'class-1', locked: true })
    )
  })

  it('does not publish when lockdown value is unchanged', async () => {
    mockPrisma.class.findUnique.mockResolvedValue({ teacherId: 'teacher-1', lockdownMode: true })
    mockPrisma.class.update.mockResolvedValue(updatedClass(true))

    await PATCH(patch({ lockdownMode: true }), ctx)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('coerces non-true values to false', async () => {
    mockPrisma.class.findUnique.mockResolvedValue({ teacherId: 'teacher-1', lockdownMode: true })
    mockPrisma.class.update.mockResolvedValue(updatedClass(false))

    await PATCH(patch({ lockdownMode: 'nope' }), ctx)
    expect(mockPrisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lockdownMode: false } })
    )
    expect(mocks.publish).toHaveBeenCalledWith(
      'lockdown:class-1',
      expect.objectContaining({ locked: false })
    )
  })

  it('rejects a non-owner', async () => {
    mockSession.mockResolvedValue({ user: { id: 'someone-else' } })
    mockPrisma.class.findUnique.mockResolvedValue({ teacherId: 'teacher-1', lockdownMode: false })

    const res = await PATCH(patch({ lockdownMode: true }), ctx)
    expect(res.status).toBe(403)
    expect(mockPrisma.class.update).not.toHaveBeenCalled()
  })
})
