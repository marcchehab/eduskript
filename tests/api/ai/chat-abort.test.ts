import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Client disconnects while the AI chat streams: the response stream gets
// cancelled, so the route's later writer.write/close calls reject. They run in
// an un-awaited async IIFE, so they must not surface as unhandledRejection.
// The upstream OpenRouter request must also receive request.signal so it is
// cancelled instead of billing tokens nobody reads.

const mocks = vi.hoisted(() => {
  let rejectStream: (err: Error) => void = () => {}
  const create = vi.fn(async (..._args: unknown[]) => ({
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }
      // Upstream request is aborted after the client went away.
      await new Promise((_, reject) => {
        rejectStream = reject
      })
    },
  }))
  return { create, abort: (err: Error) => rejectStream(err) }
})

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'u1', billingPlan: 'pro', accountType: 'teacher' } })),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/permissions', () => ({ checkSkriptPermissions: () => ({ canView: true }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    skript: {
      findUnique: vi.fn(async () => ({
        id: 's1',
        title: 'S',
        description: null,
        slug: 's',
        isPublished: true,
        pages: [],
        authors: [],
        files: [],
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({ sites: [], organizationMemberships: [] })),
    },
  },
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.create } }
  },
}))

import { POST } from '@/app/api/ai/chat/route'

describe('POST /api/ai/chat client abort', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test'
    unhandled.length = 0
    mocks.create.mockClear()
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
  })

  it('does not leak an unhandled rejection and forwards the abort signal upstream', async () => {
    const controller = new AbortController()
    const request = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skriptId: 's1', messages: [{ role: 'user', content: 'hi' }] }),
      signal: controller.signal,
    })
    const res = await POST(request)
    expect(res.status).toBe(200)

    const reader = res.body!.getReader()
    await reader.read() // first content chunk arrives
    await reader.cancel('client disconnected')
    controller.abort()

    expect(mocks.create).toHaveBeenCalledTimes(1)
    const options = mocks.create.mock.calls[0][1] as { signal?: AbortSignal } | undefined
    expect(options?.signal).toBe(request.signal)
    expect(options?.signal?.aborted).toBe(true)

    mocks.abort(new Error('Request was aborted.'))
    await new Promise((r) => setTimeout(r, 50))

    expect(unhandled).toEqual([])
  })
})
