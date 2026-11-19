// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The bucket, in memory: uploadTeacherFile writes, the public URL reads.
const bucket = new Map<string, { body: string; contentType: string }>()
const s3 = vi.hoisted(() => ({ configured: true, failUploads: false }))

vi.mock('@/lib/s3', () => ({
  isTeacherS3Configured: () => s3.configured,
  getTeacherFileUrl: (key: string) => `https://files.example/bucket/${key}`,
  uploadTeacherFile: vi.fn(async (hash: string, extension: string, buffer: Buffer, contentType: string) => {
    if (s3.failUploads) throw new Error('bucket down')
    const key = `files/${hash}.${extension}`
    bucket.set(key, { body: buffer.toString('utf8'), contentType })
    return key
  }),
  downloadTeacherFile: vi.fn(async (key: string) => {
    const object = bucket.get(key)
    if (!object) throw new Error('NoSuchKey')
    return Buffer.from(object.body, 'utf8')
  }),
}))

import { downloadTeacherFile, uploadTeacherFile } from '@/lib/s3'
import { clearTikzCache, renderTikz, stopTikzWorker } from '@/lib/tikz/render.server'

beforeEach(() => {
  bucket.clear()
  clearTikzCache()
  s3.configured = true
  s3.failUploads = false
  vi.mocked(uploadTeacherFile).mockClear()
  vi.mocked(downloadTeacherFile).mockClear()
})
afterAll(async () => {
  await stopTikzWorker()
})

const SVG_URL = /^https:\/\/files\.example\/bucket\/files\/[0-9a-f]{64}\.svg$/

describe('tikz pictures in the store', () => {
  it('stores light and dark as content-addressed SVG files and returns their URLs', async () => {
    const result = await renderTikz('\\draw (0,0) -- (2,1) node {x};')
    if (!('image' in result)) throw new Error(result.error)
    expect(result.image.light).toMatch(SVG_URL)
    expect(result.image.dark).toMatch(SVG_URL)
    expect(result.image.light).not.toBe(result.image.dark)

    const light = bucket.get(result.image.light.replace('https://files.example/bucket/', ''))
    expect(light?.contentType).toBe('image/svg+xml')
    expect(light?.body).toMatch(/^<svg xmlns=/)
    expect(light?.body).not.toContain('<text')
    // two pictures and the record
    expect(uploadTeacherFile).toHaveBeenCalledTimes(3)
  }, 30_000)

  it('finds a stored picture again without running TeX (new process, same document)', async () => {
    const first = await renderTikz('\\draw (0,0) circle (1);')
    clearTikzCache()
    vi.mocked(uploadTeacherFile).mockClear()
    const again = await renderTikz('\\draw (0,0) circle (1);')
    expect(again).toEqual(first)
    expect(uploadTeacherFile).not.toHaveBeenCalled()
  }, 30_000)

  it('keeps alt text and caption per block although the picture is shared', async () => {
    const a = await renderTikz('% alt: Erstes\n\\draw (0,0) -- (1,1);')
    const b = await renderTikz('% alt: Zweites\n% caption: Abb. 2\n\\draw (0,0) -- (1,1);')
    if (!('image' in a) || !('image' in b)) throw new Error('render failed')
    expect(a.image.alt).toBe('Erstes')
    expect(b.image.alt).toBe('Zweites')
    expect(b.image.caption).toBe('Abb. 2')
    expect(b.image.light).toBe(a.image.light)
    expect(uploadTeacherFile).toHaveBeenCalledTimes(3)
  }, 30_000)

  it('runs TeX once for the same diagram requested twice at the same time', async () => {
    const [a, b] = await Promise.all([renderTikz('\\draw (0,0) -- (3,1);'), renderTikz('\\draw (0,0) -- (3,1);')])
    expect(a).toEqual(b)
    expect(uploadTeacherFile).toHaveBeenCalledTimes(3)
  }, 30_000)

  it('inlines the picture when the bucket cannot be written, and tries the bucket again next time', async () => {
    s3.failUploads = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const inlined = await renderTikz('\\draw (0,0) -- (1,2);')
    errors.mockRestore()
    expect('image' in inlined && inlined.image.light).toMatch(/^data:image\/svg\+xml,/)

    s3.failUploads = false
    const stored = await renderTikz('\\draw (0,0) -- (1,2);')
    expect('image' in stored && stored.image.light).toMatch(SVG_URL)
  }, 30_000)

  it('does not store TeX errors', async () => {
    expect(await renderTikz('\\node {x} \\gibtsnicht;')).toEqual({ error: expect.stringContaining('Undefined control sequence') })
    expect(uploadTeacherFile).not.toHaveBeenCalled()
  }, 30_000)

  it('falls back to data URLs without a bucket', async () => {
    s3.configured = false
    const result = await renderTikz('\\draw (0,0) -- (1,3);')
    expect('image' in result && result.image.light).toMatch(/^data:image\/svg\+xml,/)
    expect(downloadTeacherFile).not.toHaveBeenCalled()
  }, 30_000)
})
