import { describe, it, expect, vi, beforeEach } from 'vitest'

// Theme editor routes: PUT /api/sites/[siteId]/theme and
// POST /api/sites/[siteId]/theme/apply. Permission = site presentation
// manager (personal owner, org owner/admin), via the real site-access helpers
// over a mocked prisma.

const PREFIX = 'https://files.test/teacher/files/'

const mocks = vi.hoisted(() => ({
  prisma: {
    site: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    organizationMember: { findUnique: vi.fn(), findMany: vi.fn() },
    pageLayout: { findUnique: vi.fn() },
    file: { findMany: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/s3', () => ({
  getTeacherFilesUrlPrefix: () => PREFIX,
  getTeacherFileUrl: (key: string) => `https://files.test/teacher/${key}`,
}))
vi.mock('@/lib/file-storage', () => ({ getS3Key: (hash: string, ext: string) => `files/${hash}.${ext}` }))

import { getServerSession } from 'next-auth'
import { PUT as saveTheme } from '@/app/api/sites/[siteId]/theme/route'
import { POST as applyTheme } from '@/app/api/sites/[siteId]/theme/apply/route'

const p = mocks.prisma
const session = getServerSession as unknown as ReturnType<typeof vi.fn>

// Sites: A and B owned by teacher-1, ORG owned by an org where teacher-1 is
// admin, FOREIGN owned by someone else.
const sites: Record<string, { id: string; slug: string; userId: string | null; organizationId: string | null; typographyPreference: string; sidebarBehavior: string; extraSettings: unknown }> = {
  A: { id: 'A', slug: 'a', userId: 'teacher-1', organizationId: null, typographyPreference: 'sober', sidebarBehavior: 'contextual', extraSettings: { hideReadingProgress: true, customCss: '.x{color:red}', titleStyle: 'logo' } },
  B: { id: 'B', slug: 'b', userId: 'teacher-1', organizationId: null, typographyPreference: 'modern', sidebarBehavior: 'full', extraSettings: { titleStyle: 'icon' } },
  ORG: { id: 'ORG', slug: 'org', userId: null, organizationId: 'org-1', typographyPreference: 'modern', sidebarBehavior: 'full', extraSettings: {} },
  FOREIGN: { id: 'FOREIGN', slug: 'f', userId: 'teacher-2', organizationId: null, typographyPreference: 'modern', sidebarBehavior: 'full', extraSettings: {} },
}
const managedByTeacher1 = ['A', 'B', 'ORG']

const req = (url: string, method: string, body: unknown) =>
  new Request(url, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const params = (siteId: string) => ({ params: Promise.resolve({ siteId }) })

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'teacher-1' } })
  p.site.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => sites[where.id] ?? null)
  p.site.findMany.mockImplementation(async () => managedByTeacher1.map(id => ({ id })))
  p.organizationMember.findUnique.mockImplementation(async ({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) =>
    where.organizationId_userId.organizationId === 'org-1' && where.organizationId_userId.userId === 'teacher-1' ? { role: 'admin' } : null)
  p.organizationMember.findMany.mockResolvedValue([])
  p.pageLayout.findUnique.mockResolvedValue(null)
  p.file.findMany.mockResolvedValue([])
  p.site.update.mockResolvedValue({})
})

describe('POST /api/sites/[siteId]/theme/apply', () => {
  it('copies the saved theme of the source to managed targets (personal + org)', async () => {
    const res = await applyTheme(req('http://localhost/api/sites/A/theme/apply', 'POST', { targetSiteIds: ['B', 'ORG', 'A'] }), params('A'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 2 })
    const updated = p.site.update.mock.calls.map(c => c[0])
    expect(updated.map(u => u.where.id)).toEqual(['B', 'ORG'])
    expect(updated[0].data).toMatchObject({ typographyPreference: 'sober', sidebarBehavior: 'contextual' })
    // Theme keys copied, unrelated extraSettings of the target kept.
    expect(updated[0].data.extraSettings).toEqual({ titleStyle: 'icon', hideReadingProgress: true, customCss: '.x{color:red}' })
  })

  it('rejects the whole request when any target is not managed by the caller', async () => {
    const res = await applyTheme(req('http://localhost/api/sites/A/theme/apply', 'POST', { targetSiteIds: ['B', 'FOREIGN'] }), params('A'))
    expect(res.status).toBe(403)
    expect(p.site.update).not.toHaveBeenCalled()
  })

  it('rejects when the caller does not manage the source site', async () => {
    const res = await applyTheme(req('http://localhost/api/sites/FOREIGN/theme/apply', 'POST', { targetSiteIds: ['B'] }), params('FOREIGN'))
    expect(res.status).toBe(403)
    expect(p.site.update).not.toHaveBeenCalled()
  })

  it('rejects an org target when the caller is only a plain member there', async () => {
    p.site.findMany.mockResolvedValue([{ id: 'A' }, { id: 'B' }]) // ORG not managed
    const res = await applyTheme(req('http://localhost/api/sites/A/theme/apply', 'POST', { targetSiteIds: ['ORG'] }), params('A'))
    expect(res.status).toBe(403)
    expect(p.site.update).not.toHaveBeenCalled()
  })

  it('401 without a session, 400 without targets', async () => {
    session.mockResolvedValueOnce(null)
    expect((await applyTheme(req('http://localhost/x', 'POST', { targetSiteIds: ['B'] }), params('A'))).status).toBe(401)
    expect((await applyTheme(req('http://localhost/x', 'POST', { targetSiteIds: [] }), params('A'))).status).toBe(400)
  })
})

describe('PUT /api/sites/[siteId]/theme', () => {
  const valid = { preset: 'latex', sidebarBehavior: 'full', showReadingProgress: false, customCss: '' }

  it('saves preset, navigation, progress opt-out; empty CSS deletes the key', async () => {
    const res = await saveTheme(req('http://localhost/api/sites/A/theme', 'PUT', valid), params('A'))
    expect(res.status).toBe(200)
    const { data } = p.site.update.mock.calls[0][0]
    expect(data).toMatchObject({ typographyPreference: 'latex', sidebarBehavior: 'full' })
    expect(data.extraSettings).toEqual({ titleStyle: 'logo', hideReadingProgress: true })
  })

  it('sanitizes custom CSS before storing and reports what was removed', async () => {
    p.file.findMany.mockResolvedValue([{ name: 'bg.png', hash: 'abc' }])
    const css = '@import url(https://evil.com/x.css);\n.a{background:url(bg.png)}\n.b{background:url(https://evil.com/t.png)}'
    const res = await saveTheme(req('http://localhost/api/sites/A/theme', 'PUT', { ...valid, showReadingProgress: true, customCss: css }), params('A'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const stored = p.site.update.mock.calls[0][0].data.extraSettings.customCss
    expect(stored).toBe(`.a{background:url("${PREFIX}abc.png")}\n.b{background:none}`)
    expect(stored).not.toContain('evil.com')
    expect(body.removed.map((r: { kind: string }) => r.kind)).toEqual(['import', 'url'])
    // hideReadingProgress removed when the bar is on again.
    expect(p.site.update.mock.calls[0][0].data.extraSettings.hideReadingProgress).toBeUndefined()
  })

  it('403 for a site the caller does not manage; 400 for an unknown preset', async () => {
    expect((await saveTheme(req('http://localhost/x', 'PUT', valid), params('FOREIGN'))).status).toBe(403)
    expect((await saveTheme(req('http://localhost/x', 'PUT', { ...valid, preset: 'neon' }), params('A'))).status).toBe(400)
    expect(p.site.update).not.toHaveBeenCalled()
  })

  it('org admins can save the org site', async () => {
    const res = await saveTheme(req('http://localhost/x', 'PUT', valid), params('ORG'))
    expect(res.status).toBe(200)
    expect(p.site.update.mock.calls[0][0].where.id).toBe('ORG')
  })
})
