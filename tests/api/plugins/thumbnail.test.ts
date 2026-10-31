// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    plugin: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.update },
  },
}))
vi.mock('@/lib/s3', () => ({
  isTeacherS3Configured: () => true,
  uploadTeacherFile: mocks.upload,
  getTeacherFileUrl: (key: string) => `https://bucket.test/${key}`,
}))

import { POST, DELETE } from '@/app/api/plugins/[ownerSlug]/[pluginSlug]/thumbnail/route'
import { PLUGIN_THUMBNAIL } from '@/lib/plugin-thumbnail'
import { createPluginForUser, updatePluginForUser } from '@/lib/services/plugins'

const params = Promise.resolve({ ownerSlug: 'owner', pluginSlug: 'clock' })
const updatedAt = new Date('2026-01-02T03:04:05Z')
const KEY = `files/${'a'.repeat(64)}.webp`
const image = (width = 48, height = 30, format: 'webp' | 'png' = 'webp') =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } }).toFormat(format).toBuffer()

function post(bytes: Uint8Array | string, type = 'image/webp') {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], 'thumbnail', { type }))
  return new Request('http://localhost/x', { method: 'POST', body: form }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'author' } })
  mocks.findFirst.mockResolvedValue({ id: 'p1', authorId: 'author' })
  mocks.findUnique.mockResolvedValue({ id: 'p1', authorId: 'author', updatedAt, manifest: { defaultHeight: 500 } })
  mocks.update.mockResolvedValue({})
  mocks.upload.mockImplementation(async (hash: string, ext: string) => `files/${hash}.${ext}`)
})

describe('POST thumbnail', () => {
  it('stores the key, reports the URL and keeps updatedAt and the rest of the manifest', async () => {
    const res = await POST(post(await image()), { params })
    expect(res.status).toBe(200)
    const [hash, ext, , mime] = mocks.upload.mock.calls[0]
    expect(ext).toBe('webp')
    expect(mime).toBe('image/webp')
    expect((await res.json()).thumbnailUrl).toBe(`https://bucket.test/files/${hash}.webp`)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { manifest: { defaultHeight: 500, thumbnailKey: `files/${hash}.webp` }, updatedAt },
    })
  })

  it('rejects anonymous users', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(post(await image()), { params })).status).toBe(401)
  })

  it('rejects everyone but the author before touching storage', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'someone-else' } })
    expect((await POST(post(await image()), { params })).status).toBe(403)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects files over the limit', async () => {
    const res = await POST(post(new Uint8Array(PLUGIN_THUMBNAIL.maxBytes + 1)), { params })
    expect(res.status).toBe(413)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('decides the format from the bytes, not from the claimed type', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    expect((await POST(post(svg, 'image/webp'), { params })).status).toBe(400)
    expect((await POST(post(await image(48, 30, 'png'), 'image/webp'), { params })).status).toBe(400)
    expect((await POST(post('not an image'), { params })).status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})

describe('DELETE thumbnail', () => {
  it('clears the key and keeps updatedAt', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'p1', authorId: 'author', updatedAt, manifest: { defaultHeight: 500, thumbnailKey: KEY } })
    const res = await DELETE(new Request('http://localhost/x') as never, { params })
    expect(await res.json()).toEqual({ thumbnailUrl: null })
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { manifest: { defaultHeight: 500 }, updatedAt } })
  })

  it('rejects everyone but the author', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'someone-else' } })
    expect((await DELETE(new Request('http://localhost/x') as never, { params })).status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('manifest writes through the plugin service', () => {
  it('update keeps the stored thumbnail and ignores one sent by the client', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'p1', authorId: 'author', entryHtml: 'x', manifest: { thumbnailKey: KEY } })
    mocks.update.mockResolvedValue({ author: { id: 'author', name: null, image: null, sites: [] } })
    await updatePluginForUser('author', 'p1', { manifest: { defaultHeight: 300, thumbnailKey: 'files/forged.webp' } })
    expect(mocks.update.mock.calls[0][0].data.manifest).toEqual({ defaultHeight: 300, thumbnailKey: KEY })
  })

  it('update without a manifest leaves it alone', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'p1', authorId: 'author', entryHtml: 'x', manifest: { thumbnailKey: KEY } })
    mocks.update.mockResolvedValue({ author: { id: 'author', name: null, image: null, sites: [] } })
    await updatePluginForUser('author', 'p1', { name: 'New' })
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('manifest')
  })
})

describe('createPluginForUser', () => {
  it('does not accept a thumbnail key from the client', async () => {
    const create = vi.fn(async () => ({ author: { id: 'author', name: null, image: null, sites: [] } }))
    const { prisma } = await import('@/lib/prisma')
    Object.assign(prisma.plugin, { create })
    mocks.findUnique.mockResolvedValue(null)
    await createPluginForUser('author', { slug: 'clock', name: 'Clock', entryHtml: 'x', manifest: { thumbnailKey: KEY, defaultHeight: 1 } })
    expect((create.mock.calls as unknown[][])[0][0]).toMatchObject({ data: { manifest: { defaultHeight: 1 } } })
    expect(((create.mock.calls as unknown[][])[0][0] as { data: { manifest: object } }).data.manifest).not.toHaveProperty('thumbnailKey')
  })
})
