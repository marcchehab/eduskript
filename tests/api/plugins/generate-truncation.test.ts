import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// QA finding ai-plugin-generate-too-large-after-3min: a nearly empty cut-off
// (reasoning used up max_tokens) was reported as "too large", and 3 attempts
// ran back to back with no upper bound on the wait.

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/billing', () => ({ isPaidUser: () => true, paidOnlyResponse: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { importJob: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) } },
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.create } }
  },
}))

import { POST } from '@/app/api/plugins/generate/route'

const req = () =>
  new Request('http://localhost/api/plugins/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Schiefer Wurf' }),
  }) as never

const truncated = (len: number) => ({
  choices: [{ message: { content: 'x'.repeat(len) }, finish_reason: 'length' }],
})

describe('POST /api/plugins/generate truncation', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test'
    mocks.create.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('does not call a nearly empty cut-off "too large"', async () => {
    mocks.create.mockResolvedValue(truncated(687))
    const res = await POST(req())
    const body = await res.json()
    expect(body.error).not.toMatch(/too large/i)
    expect(body.error).toMatch(/try again/i)
  })

  it('still reports "too large" when the model wrote a lot', async () => {
    mocks.create.mockResolvedValue(truncated(40_000))
    const res = await POST(req())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/too large/i)
  })

  it('stops retrying once the time budget is used up', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.create.mockImplementation(async () => {
      now += 110_000 // one slow attempt eats most of the budget
      return truncated(0)
    })
    const res = await POST(req())
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(false)
    // Every attempt is bounded by the remaining budget.
    const opts = mocks.create.mock.calls[0][1] as { timeout: number }
    expect(opts.timeout).toBeLessThanOrEqual(120_000)
  })
})
