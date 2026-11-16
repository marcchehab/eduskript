// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  siteFindUnique: vi.fn(),
  count: vi.fn(),
  dataCount: vi.fn(),
  memberships: vi.fn(),
  userUpdate: vi.fn(),
  classes: vi.fn(),
  pageFindUnique: vi.fn(),
  dataFindUnique: vi.fn(),
  dataFindMany: vi.fn(),
  upsert: vi.fn(),
  access: vi.fn(),
  placed: vi.fn(),
  publish: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/events', () => ({ eventBus: { publish: mocks.publish } }))
vi.mock('@/lib/plugin-share.server', () => ({ notifyNicknameChange: mocks.notify }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/site-access', () => ({ getSiteAccess: mocks.access, isSkriptPlacedOnSite: mocks.placed }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    site: { findUnique: mocks.siteFindUnique },
    classMembership: { count: mocks.count, findMany: mocks.memberships },
    user: { update: mocks.userUpdate },
    class: { findMany: mocks.classes },
    page: { findUnique: mocks.pageFindUnique },
    userData: { findUnique: mocks.dataFindUnique, findMany: mocks.dataFindMany, upsert: mocks.upsert, count: mocks.dataCount },
  },
}))

import { GET, PATCH, POST } from '@/app/api/plugin-share/route'

const req = (method: string, body?: unknown, query = '') =>
  new Request(`http://localhost/api/plugin-share${query}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  }) as never
const publish = { siteId: 's', pageId: 'p', componentId: 'plugin-x', share: 'class', values: { score: 5 } }
const member = (classId: string, studentId: string, extra = {}) => ({
  classId, studentId, identityConsent: false, student: { name: `Nick ${studentId}`, email: `${studentId}@real.test` }, ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'stu1' } })
  mocks.siteFindUnique.mockResolvedValue({ userId: 'teacher' })
  mocks.count.mockResolvedValue(1)
  mocks.placed.mockResolvedValue(true)
  mocks.pageFindUnique.mockResolvedValue({ content: '<plugin src="a/b" share="class" />', skriptId: 'sk' })
  mocks.dataFindUnique.mockResolvedValue(null)
  mocks.access.mockResolvedValue({ isOwner: false })
  mocks.dataFindMany.mockResolvedValue([])
  mocks.classes.mockResolvedValue([{ id: 'c1', name: '3a' }])
})

describe('POST /api/plugin-share', () => {
  it('requires a login', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(req('POST', publish))).status).toBe(401)
  })

  it('stores a member\'s values, one row per list and embedding', async () => {
    const res = await POST(req('POST', publish))
    expect(await res.json()).toEqual({ stored: true })
    const arg = mocks.upsert.mock.calls[0][0]
    expect(arg.create).toMatchObject({
      userId: 'stu1', siteId: 's', adapter: 'plugin-share', itemId: 'class',
      targetType: 'plugin', targetId: 'p:plugin-x', data: { score: 5 },
    })
  })

  it('notifies open leaderboards in the affected classes', async () => {
    mocks.classes.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    await POST(req('POST', publish))
    expect(mocks.classes.mock.calls[0][0].where.memberships).toEqual({ some: { studentId: 'stu1' } })
    expect(mocks.publish.mock.calls.map((c) => c[0])).toEqual(['class:c1', 'class:c2'])
    expect(mocks.publish.mock.calls[0][1]).toEqual({ type: 'leaderboard-update', siteId: 's', list: 'class' })
  })

  it('keeps the best value by default', async () => {
    mocks.dataFindUnique.mockResolvedValue({ data: { score: 9 } })
    await POST(req('POST', publish))
    expect(mocks.upsert.mock.calls[0][0].update.data).toEqual({ score: 9 })
  })

  it('ignores viewers outside the classes without an error', async () => {
    mocks.count.mockResolvedValue(0)
    const res = await POST(req('POST', publish))
    expect(await res.json()).toEqual({ stored: false })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a list the page does not share into', async () => {
    expect((await POST(req('POST', { ...publish, share: 'other-list' }))).status).toBe(403)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('accepts a leaderboard of that list on the page, in any attribute order', async () => {
    for (const tag of ['<leaderboard source="kapitel-3" />', "<leaderboard limit=\"5\" source='kapitel-3'/>"]) {
      mocks.pageFindUnique.mockResolvedValue({ content: tag, skriptId: 'sk' })
      expect((await POST(req('POST', { ...publish, share: 'kapitel-3' }))).status).toBe(200)
    }
  })

  it('a leaderboard of another list gives no write access', async () => {
    mocks.pageFindUnique.mockResolvedValue({ content: '<leaderboard source="other" />', skriptId: 'sk' })
    expect((await POST(req('POST', { ...publish, share: 'kapitel-3' }))).status).toBe(403)
  })

  it('a leaderboard without source collects into the class list', async () => {
    mocks.pageFindUnique.mockResolvedValue({ content: '<leaderboard limit="5" />', skriptId: 'sk' })
    expect((await POST(req('POST', publish))).status).toBe(200)
  })

  it('rejects a page not placed on the site', async () => {
    mocks.placed.mockResolvedValue(false)
    expect((await POST(req('POST', publish))).status).toBe(403)
  })

  it('caps new rows per list, but still updates existing ones', async () => {
    mocks.dataCount.mockResolvedValue(200)
    expect((await POST(req('POST', publish))).status).toBe(403)
    expect(mocks.upsert).not.toHaveBeenCalled()
    mocks.dataFindUnique.mockResolvedValue({ data: { score: 1 } })
    expect((await POST(req('POST', publish))).status).toBe(200)
  })

  it('does not collect exam pages', async () => {
    mocks.pageFindUnique.mockResolvedValue({
      content: '<leaderboard source="kapitel-3" />', skriptId: 'sk', pageType: 'exam',
    })
    expect((await POST(req('POST', { ...publish, share: 'kapitel-3' }))).status).toBe(403)
  })

  it('rejects values without a number', async () => {
    expect((await POST(req('POST', { ...publish, values: { a: 'x' } }))).status).toBe(400)
  })

  it('stores a payload next to the values and keeps it when not sent again', async () => {
    await POST(req('POST', { ...publish, payload: { strokes: [[1, 2]] } }))
    expect(mocks.upsert.mock.calls[0][0].create.data).toEqual({ score: 5, _payload: { strokes: [[1, 2]] } })
    mocks.dataFindUnique.mockResolvedValue({ data: { score: 5, _payload: 'old' } })
    await POST(req('POST', publish))
    expect(mocks.upsert.mock.calls[1][0].update.data).toEqual({ score: 5, _payload: 'old' })
  })

  it('rejects a payload over the size limit and reserved keys as values', async () => {
    expect((await POST(req('POST', { ...publish, payload: 'x'.repeat(8001) }))).status).toBe(413)
    expect((await POST(req('POST', { ...publish, values: { _payload: 1 } }))).status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('lets only the site owner write the shared state', async () => {
    const body = { siteId: 's', pageId: 'p', componentId: 'plugin-x', share: 'class', shared: { round: 2 } }
    expect((await POST(req('POST', body))).status).toBe(403)
    expect(mocks.upsert).not.toHaveBeenCalled()

    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    mocks.classes.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    const res = await (await POST(req('POST', body))).json()
    expect(res.stored).toBe(true)
    const arg = mocks.upsert.mock.calls[0][0]
    expect(arg.create).toMatchObject({ userId: 'teacher', itemId: 'class', targetId: 'p:plugin-x' })
    expect(arg.create.data).toEqual({ _shared: { round: 2 }, _at: res.at })
    expect(mocks.publish.mock.calls.map((c) => c[0])).toEqual(['class:c1', 'class:c2'])
    expect(mocks.publish.mock.calls[0][1]).toEqual({ type: 'leaderboard-update', siteId: 's', list: 'class', shared: true })
  })

  it('the shared state needs share on the page too', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    mocks.pageFindUnique.mockResolvedValue({ content: 'no plugin', skriptId: 'sk' })
    const body = { siteId: 's', pageId: 'p', componentId: 'plugin-x', share: 'class', shared: 1 }
    expect((await POST(req('POST', body))).status).toBe(403)
  })
})

describe('GET /api/plugin-share', () => {
  const rows = [{ userId: 'stu1', data: { score: 5 } }, { userId: 'stu2', data: { score: 8 } }]

  it('shows nothing to someone outside the classes', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu2')])
    const body = await (await GET(req('GET', undefined, '?siteId=s&source=class'))).json()
    expect(body).toMatchObject({ member: false, entries: [] })
    expect(mocks.dataFindMany).not.toHaveBeenCalled()
  })

  it('gives students nicknames, never emails or ids', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c1', 'stu2', { identityConsent: true })])
    mocks.dataFindMany.mockResolvedValue(rows)
    const body = await (await GET(req('GET', undefined, '?siteId=s&source=class'))).json()
    expect(body.entries).toEqual([
      { rank: 1, nickname: 'Nick stu2', value: 8, isSelf: false },
      { rank: 2, nickname: 'Nick stu1', value: 5, isSelf: true },
    ])
    expect(body.nickname).toBe('Nick stu1')
    expect(JSON.stringify(body)).not.toContain('real.test')
  })

  it('returns payloads of the asked embedding only, and only on request', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c1', 'stu2')])
    mocks.dataFindMany.mockResolvedValue([
      { userId: 'stu1', targetId: 'p:plugin-x', data: { score: 5, _payload: 'mine' } },
      { userId: 'stu2', targetId: 'p:other', data: { score: 8, _payload: 'elsewhere' } },
    ])
    const q = '?siteId=s&source=class&pageId=p&componentId=plugin-x'
    const without = await (await GET(req('GET', undefined, q))).json()
    expect(JSON.stringify(without)).not.toContain('mine')
    const body = await (await GET(req('GET', undefined, `${q}&payload=1`))).json()
    expect(body.entries).toEqual([
      { rank: 1, nickname: 'Nick stu2', value: 8, isSelf: false },
      { rank: 2, nickname: 'Nick stu1', value: 5, isSelf: true, payload: 'mine' },
    ])
  })

  it('returns the owner\'s shared state with the server time', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1')])
    const q = '?siteId=s&source=class&pageId=p&componentId=plugin-x'
    expect((await (await GET(req('GET', undefined, q))).json()).shared).toBeNull()
    expect(await (await GET(req('GET', undefined, '?siteId=s&source=class'))).json()).not.toHaveProperty('shared')

    mocks.dataFindUnique.mockResolvedValue({ data: { _shared: { round: 2 }, _at: 1000 } })
    const body = await (await GET(req('GET', undefined, q))).json()
    expect(body.shared).toEqual({ value: { round: 2 }, at: 1000 })
    expect(body.isOwner).toBe(false)
    expect(typeof body.now).toBe('number')
    expect(mocks.dataFindUnique.mock.calls.at(-1)![0].where.userId_siteId_adapter_itemId_targetType_targetId)
      .toMatchObject({ userId: 'teacher', targetId: 'p:plugin-x' })
  })

  it('gives the site owner the email only with identity consent', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    mocks.access.mockResolvedValue({ isOwner: true })
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c1', 'stu2', { identityConsent: true })])
    mocks.dataFindMany.mockResolvedValue(rows)
    const { entries } = await (await GET(req('GET', undefined, '?siteId=s&source=class'))).json()
    expect(entries[0]).toMatchObject({ studentId: 'stu2', email: 'stu2@real.test' })
    expect(entries[1]).toMatchObject({ studentId: 'stu1', email: null })
  })

  it('a class list ignores consent given in another class', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    mocks.access.mockResolvedValue({ isOwner: true })
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c2', 'stu1', { identityConsent: true })])
    mocks.classes.mockResolvedValue([{ id: 'c1', name: '3a' }, { id: 'c2', name: '3b' }])
    mocks.dataFindMany.mockResolvedValue(rows.slice(0, 1))
    const { entries } = await (await GET(req('GET', undefined, '?siteId=s&source=class&classId=c1'))).json()
    expect(entries[0].email).toBeNull()
  })

  it('a student in two classes appears in both class lists', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c2', 'stu1'), member('c2', 'stu2')])
    mocks.classes.mockResolvedValue([{ id: 'c1', name: '3a' }, { id: 'c2', name: '3b' }])
    mocks.dataFindMany.mockResolvedValue(rows.slice(0, 1))
    for (const classId of ['c1', 'c2']) {
      const body = await (await GET(req('GET', undefined, `?siteId=s&source=class&classId=${classId}`))).json()
      expect(body.classId).toBe(classId)
      expect(body.entries[0].isSelf).toBe(true)
    }
  })

  it('a student cannot read another class', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c2', 'stu2')])
    await GET(req('GET', undefined, '?siteId=s&source=class&classId=c2'))
    expect(mocks.dataFindMany.mock.calls[0][0].where.userId.in).toEqual(['stu1'])
  })

  it('a named list covers all classes of the site', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c2', 'stu2')])
    await GET(req('GET', undefined, '?siteId=s&source=toplist-logarithms'))
    const where = mocks.dataFindMany.mock.calls[0][0].where
    expect(where.userId.in.sort()).toEqual(['stu1', 'stu2'])
    expect(where).toMatchObject({ siteId: 's', itemId: 'toplist-logarithms' })
  })

  it('returns the viewer outside the limit as self', async () => {
    mocks.memberships.mockResolvedValue([member('c1', 'stu1'), member('c1', 'stu2')])
    mocks.dataFindMany.mockResolvedValue(rows)
    const body = await (await GET(req('GET', undefined, '?siteId=s&source=class&limit=1'))).json()
    expect(body.entries).toHaveLength(1)
    expect(body.self).toMatchObject({ rank: 2, isSelf: true })
  })
})

describe('PATCH /api/plugin-share', () => {
  const rename = { siteId: 's', nickname: 'Ada L', studentId: 'stu2' }

  it('lets only the site owner rename a student', async () => {
    expect((await PATCH(req('PATCH', rename))).status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    expect((await PATCH(req('PATCH', rename))).status).toBe(200)
    expect(mocks.userUpdate.mock.calls[0][0]).toEqual({ where: { id: 'stu2' }, data: { name: 'Ada L' } })
    expect(mocks.notify).toHaveBeenCalledWith('stu2')
  })

  it('rejects a bad nickname and non-members', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'teacher' } })
    expect((await PATCH(req('PATCH', { ...rename, nickname: 'x' }))).status).toBe(400)
    mocks.count.mockResolvedValue(0)
    expect((await PATCH(req('PATCH', rename))).status).toBe(403)
  })
})
