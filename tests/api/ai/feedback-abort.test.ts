import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Client aborts (reload) while feedback streams: the response stream gets
// cancelled, so the route's later writer.write/close calls reject. They run in
// an un-awaited async IIFE, so they must not surface as unhandledRejection.

const mocks = vi.hoisted(() => {
  let rejectStream: (err: Error) => void = () => {}
  const create = vi.fn(async () => ({
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

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: {
      findUnique: vi.fn(async () => ({
        content: '<ai-feedback id="f1" prompt="x" />',
        skriptId: 's1',
        isPublished: true,
        authors: [],
        skript: { isPublished: true, authors: [], collectionSkripts: [] },
      })),
    },
    frontPage: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/ai/feedback-context', () => ({
  extractFeedbackContext: () => ({ prompt: null, sectionMarkdown: 'Exercise', solution: null }),
}))
vi.mock('@/lib/ai/feedback-solution', () => ({ loadSolutionImage: vi.fn(async () => null) }))
vi.mock('@/lib/metrics/buffer', () => ({ recordMetric: vi.fn() }))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.create } }
  },
}))

import { POST } from '@/app/api/ai/feedback/route'

describe('POST /api/ai/feedback client abort', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test'
    process.env.INFOMANIAK_AI_TOKEN = 'test'
    process.env.INFOMANIAK_AI_PRODUCT_ID = '1'
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
  })

  it('does not leak an unhandled rejection when the client disconnects mid-stream', async () => {
    const res = await POST(
      new Request('http://localhost/api/ai/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: 'p1', image: 'data:image/png;base64,AAAA' }),
      })
    )
    expect(res.status).toBe(200)

    const reader = res.body!.getReader()
    await reader.read() // first content chunk arrives
    await reader.cancel('client disconnected') // page reload

    mocks.abort(new Error('ResponseAborted'))
    await new Promise((r) => setTimeout(r, 50))

    expect(unhandled).toEqual([])
  })
})
