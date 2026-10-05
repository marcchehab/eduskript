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
vi.mock('@/lib/plugin-templates/server', () => ({ templatePromptSection: vi.fn(async () => '- europe: Europa') }))
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

// The route streams; the mock yields the whole text in one chunk.
const streamOf = (content: string, finish: string) => ({
  async *[Symbol.asyncIterator]() {
    yield { choices: [{ delta: { content }, finish_reason: finish }] }
  },
})
const truncated = (len: number) => streamOf('x'.repeat(len), 'length')

// Last NDJSON event of the response body.
async function lastEvent(res: Response) {
  const lines = (await res.text()).trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}

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
    const body = await lastEvent(await POST(req()))
    expect(body.type).toBe('error')
    expect(body.error).not.toMatch(/too (large|long)/i)
    expect(body.error).toMatch(/try again/i)
  })

  it('still says the plugin got too long when the model wrote a lot', async () => {
    mocks.create.mockResolvedValue(truncated(40_000))
    expect((await lastEvent(await POST(req()))).error).toMatch(/too long/i)
  })

  it('streams the plugin with the AI summary', async () => {
    mocks.create.mockResolvedValue(streamOf('<!-- summary: Ein Wurf-Simulator. -->\n<div>x</div>', 'stop'))
    expect(await lastEvent(await POST(req()))).toEqual({ type: 'done', entryHtml: '<div>x</div>', summary: 'Ein Wurf-Simulator.' })
  })

  it('asks for a template when none fits', async () => {
    mocks.create.mockResolvedValue(streamOf('<!-- needs-template: eine Karte von Afrika -->', 'stop'))
    expect(await lastEvent(await POST(req()))).toEqual({ type: 'needs-template', need: 'eine Karte von Afrika' })
  })

  it('passes a clarifying question through instead of a plugin', async () => {
    mocks.create.mockResolvedValue(streamOf('<!-- question: Was soll das Plugin können? -->', 'stop'))
    expect(await lastEvent(await POST(req()))).toEqual({ type: 'question', question: 'Was soll das Plugin können?' })
  })

  it('stops retrying once the time budget is used up', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.create.mockImplementation(async () => {
      now += 110_000 // one slow attempt eats most of the budget
      return truncated(0)
    })
    const body = await lastEvent(await POST(req()))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(body.type).toBe('error')
    // Every attempt is bounded by the remaining budget.
    const opts = mocks.create.mock.calls[0][1] as { timeout: number }
    expect(opts.timeout).toBeLessThanOrEqual(120_000)
  })
})
