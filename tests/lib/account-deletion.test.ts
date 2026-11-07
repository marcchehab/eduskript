/**
 * Account deletion against a real Postgres (src/lib/account-deletion.ts): the
 * point is the FK behaviour (PageVersion.authorId SET NULL, File.createdBy
 * cascade, RESTRICT refs), which a mocked prisma cannot show.
 *
 * Creates a throwaway database next to DATABASE_URL from .env, applies the
 * migrations with `prisma migrate deploy`, drops it afterwards. Skipped when
 * .env has no PostgreSQL DATABASE_URL. The database named in .env itself is
 * never written to.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import { resolve } from 'path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const rootDir = resolve(__dirname, '../..')
const baseUrl = config({ path: resolve(rootDir, '.env'), processEnv: {} }).parsed?.DATABASE_URL
const hasDb = !!baseUrl?.startsWith('postgresql://')

let db: PrismaClient
vi.mock('@/lib/prisma', () => ({ get prisma() { return db } }))
vi.mock('@/lib/s3', () => ({
  isS3Configured: () => false,
  isTeacherS3Configured: () => false,
  deleteSnapImage: vi.fn(),
  deleteTeacherFile: vi.fn(),
}))
vi.mock('@/lib/file-storage', () => ({ getFileExtension: (n: string) => n.split('.').pop() }))
vi.mock('@/lib/site-revalidate', () => ({
  getPlacingSites: vi.fn(async () => []),
  revalidateSkriptOnPlacingSites: vi.fn(async () => {}),
}))

const { deleteUserAccount, getAccountDeletionPreview } = await import('@/lib/account-deletion')

const dbName = `test_account_deletion_${randomBytes(6).toString('hex')}`
const adminUrl = () => { const u = new URL(baseUrl!); u.pathname = '/postgres'; return u.toString() }
const testUrl = () => { const u = new URL(baseUrl!); u.pathname = `/${dbName}`; return u.toString() }

/**
 * A (deleted), B (co-author), C (viewer only).
 * - soleSkript:    A alone (C is viewer) → deleted in both modes
 * - sharedSkript:  A + B authors; page with a version by A and one by B, a
 *                  file uploaded by A, a skript frontpage version by A, and a
 *                  root layout item on B's site
 * - bSkript:       B alone; bPage has A as page-level author
 * - orgFiles:      hidden file-storage skript of an org frontpage, A alone
 */
async function seed(tag: string) {
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((n) =>
    db.user.create({ data: { email: `${n}-${tag}@test.ch`, name: `User ${n.toUpperCase()}` } })))
  const bSite = await db.site.create({ data: { slug: `b-${tag}`, userId: b.id } })
  await db.site.create({ data: { slug: `a-${tag}`, userId: a.id } })

  const soleSkript = await db.skript.create({
    data: {
      title: 'Sole', slug: `sole-${tag}`,
      authors: { create: [{ userId: a.id }, { userId: c.id, permission: 'viewer' }] },
      pages: { create: { title: 'Sole page', slug: 'p', content: 'x', order: 0 } },
    },
  })
  const sharedSkript = await db.skript.create({
    data: { title: 'Shared', slug: `shared-${tag}`, authors: { create: [{ userId: a.id }, { userId: b.id }] } },
  })
  const sharedPage = await db.page.create({
    data: {
      title: 'Shared page', slug: 'p', content: 'v2', order: 0, skriptId: sharedSkript.id,
      authors: { create: [{ userId: a.id }] },
      versions: { create: [{ version: 1, content: 'v1', authorId: a.id }, { version: 2, content: 'v2', authorId: b.id }] },
    },
  })
  await db.file.create({ data: { name: 'img.png', skriptId: sharedSkript.id, createdBy: a.id, hash: `h-${tag}` } })
  await db.frontPage.create({
    data: { skriptId: sharedSkript.id, content: 'fp', versions: { create: { version: 1, content: 'fp', authorId: a.id } } },
  })
  await db.pageLayout.create({
    data: { siteId: bSite.id, items: { create: { type: 'skript', contentId: sharedSkript.id, order: 0 } } },
  })

  const bSkript = await db.skript.create({
    data: { title: 'B only', slug: `b-${tag}`, authors: { create: { userId: b.id } } },
  })
  const bPage = await db.page.create({
    data: { title: 'B page', slug: 'p', content: 'x', order: 0, skriptId: bSkript.id, authors: { create: { userId: a.id } } },
  })

  const org = await db.organization.create({ data: { name: `Org ${tag}` } })
  const orgSite = await db.site.create({ data: { slug: `org-site-${tag}`, organizationId: org.id } })
  const orgFiles = await db.skript.create({
    data: { title: 'Organization Front Page Files', slug: `__fp-${tag}`, authors: { create: { userId: a.id } } },
  })
  await db.frontPage.create({ data: { siteId: orgSite.id, fileSkriptId: orgFiles.id } })

  return { a, b, c, soleSkript, sharedSkript, sharedPage, bSkript, bPage, orgFiles }
}

describe.skipIf(!hasDb)('deleteUserAccount (real Postgres)', () => {
  beforeAll(() => {
    execSync(`psql "${adminUrl()}" -c "CREATE DATABASE ${dbName};"`, { stdio: 'pipe' })
    execSync('pnpm prisma migrate deploy', { cwd: rootDir, stdio: 'pipe', env: { ...process.env, DATABASE_URL: testUrl() } })
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl() }) })
  }, 120_000)

  afterAll(async () => {
    await db?.$disconnect()
    execSync(`psql "${adminUrl()}" -c "DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);"`, { stdio: 'pipe' })
  })

  it('preview lists sole counts and shared items with their co-authors', async () => {
    const s = await seed('preview')
    const preview = await getAccountDeletionPreview(s.a.id)
    // orgFiles (org frontpage storage) is not counted: it is never deleted.
    expect(preview.soleSkripts).toBe(1)
    expect(preview.sharedSkripts).toEqual([{ id: s.sharedSkript.id, title: 'Shared', coAuthors: [{ name: 'User B', email: 'b-preview@test.ch' }] }])
    expect(preview.sharedPages).toEqual([{ id: s.bPage.id, title: 'B page', skriptTitle: 'B only', coAuthors: [{ name: 'User B', email: 'b-preview@test.ch' }] }])
    expect(preview.solePages).toBe(0)
  })

  it('transfer: shared content stays with co-authors, incl. the deleted author\'s versions', async () => {
    const s = await seed('transfer')
    await deleteUserAccount(s.a.id, 'transfer')

    expect(await db.user.findUnique({ where: { id: s.a.id } })).toBeNull()
    expect(await db.skript.findUnique({ where: { id: s.soleSkript.id } })).toBeNull()
    expect(await db.skript.findUnique({ where: { id: s.sharedSkript.id } })).not.toBeNull()
    expect(await db.page.findUnique({ where: { id: s.bPage.id } })).not.toBeNull()
    expect(await db.skript.findUnique({ where: { id: s.orgFiles.id } })).not.toBeNull()

    const versions = await db.pageVersion.findMany({ where: { pageId: s.sharedPage.id }, orderBy: { version: 'asc' } })
    expect(versions.map((v) => [v.version, v.authorId])).toEqual([[1, null], [2, s.b.id]])
    const fpVersions = await db.frontPageVersion.findMany({ where: { frontPage: { skriptId: s.sharedSkript.id } } })
    expect(fpVersions.map((v) => v.authorId)).toEqual([null])

    const files = await db.file.findMany({ where: { skriptId: s.sharedSkript.id } })
    expect(files.map((f) => f.createdBy)).toEqual([s.b.id])
    expect(await db.pageLayoutItem.count({ where: { contentId: s.sharedSkript.id } })).toBe(1)
  })

  it('delete: everything A authors goes, incl. shared skripts and page-level pages', async () => {
    const s = await seed('delete')
    await deleteUserAccount(s.a.id, 'delete')

    expect(await db.user.findUnique({ where: { id: s.a.id } })).toBeNull()
    expect(await db.user.findUnique({ where: { id: s.b.id } })).not.toBeNull()
    expect(await db.skript.findUnique({ where: { id: s.soleSkript.id } })).toBeNull()
    expect(await db.skript.findUnique({ where: { id: s.sharedSkript.id } })).toBeNull()
    expect(await db.page.findUnique({ where: { id: s.bPage.id } })).toBeNull()
    // B's own skript stays; only the page A authored inside it is gone.
    expect(await db.skript.findUnique({ where: { id: s.bSkript.id } })).not.toBeNull()
    // The org outlives A, so does its frontpage file storage.
    expect(await db.skript.findUnique({ where: { id: s.orgFiles.id } })).not.toBeNull()
    // B's site no longer lists the deleted skript (no FK on contentId).
    expect(await db.pageLayoutItem.count({ where: { contentId: s.sharedSkript.id } })).toBe(0)
  })

  it('a co-author\'s versions survive their account deletion even without any deletion helper', async () => {
    // Guards the schema itself: plain user.delete must not cascade into versions.
    const s = await seed('cascade')
    await db.user.delete({ where: { id: s.b.id } })
    const versions = await db.pageVersion.findMany({ where: { pageId: s.sharedPage.id }, orderBy: { version: 'asc' } })
    expect(versions.map((v) => [v.version, v.authorId])).toEqual([[1, s.a.id], [2, null]])
  })
})
