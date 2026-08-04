/**
 * getSkriptFiles used to be `revalidate: 60`. That looked local but was not: a
 * route's revalidation is the MINIMUM of its segment config and every cached
 * source used during the render, and this one is reached from
 * ServerMarkdownRenderer — i.e. from every public page. So it silently overrode
 * `export const revalidate = false` site-wide and pages went stale ~2 minutes
 * after being cached, which is why the database never got a 5-minute idle
 * window.
 *
 * These tests pin the replacement: cached until a tag is dropped, and every
 * writer of File/Video rows drops one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidateTag = vi.fn()
const unstable_cache = vi.fn((fn: () => unknown, _keys: string[], opts: unknown) => {
  lastCacheOptions = opts
  return fn
})
let lastCacheOptions: unknown

vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
  unstable_cache: (fn: () => unknown, keys: string[], opts: unknown) => unstable_cache(fn, keys, opts),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    file: { findMany: vi.fn(async () => []) },
    video: { findMany: vi.fn(async () => []) },
  },
}))

vi.mock('@/lib/file-storage', () => ({ getS3Key: () => 'key' }))
vi.mock('@/lib/s3', () => ({ getTeacherFileUrl: () => 'https://example.test/file' }))

beforeEach(() => {
  revalidateTag.mockClear()
  lastCacheOptions = undefined
})

describe('getSkriptFiles caching', () => {
  it('caches until invalidated instead of expiring on a timer', async () => {
    const { getSkriptFiles } = await import('@/lib/skript-files.server')
    await getSkriptFiles('skript-1')

    const opts = lastCacheOptions as { revalidate: unknown; tags: string[] }
    // A number here would cap every public route's revalidation at that value.
    expect(opts.revalidate).toBe(false)
    expect(opts.tags).toContain('skript-files')
    expect(opts.tags).toContain('skript:skript-1')
  })

  it('drops the skript tag and the coarse tag when a skript is named', async () => {
    const { invalidateSkriptFiles } = await import('@/lib/skript-files.server')
    invalidateSkriptFiles('skript-1')

    const tags = revalidateTag.mock.calls.map(c => c[0])
    expect(tags).toContain('skript-files')
    expect(tags).toContain('skript:skript-1')
  })

  it('drops only the coarse tag when the caller cannot name a skript', async () => {
    // The Mux webhook and admin video tools work from an asset id, and a video
    // is M2M with skripts, so they cannot resolve one.
    const { invalidateSkriptFiles } = await import('@/lib/skript-files.server')
    invalidateSkriptFiles()

    const tags = revalidateTag.mock.calls.map(c => c[0])
    expect(tags).toEqual(['skript-files'])
  })
})
