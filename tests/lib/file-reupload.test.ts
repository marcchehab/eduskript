import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; name: string; skriptId: string; parentId: string | null; isDirectory: boolean; hash: string }

const { rows, prismaMock } = vi.hoisted(() => {
  const rows: Row[] = []
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object') return row.id !== (value as { not: string }).not
      return row[key as keyof Row] === value
    })
  const prismaMock = {
    file: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)),
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, id: `new-${rows.length}` }
        rows.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  }
  return { rows, prismaMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/s3', () => ({
  isTeacherS3Configured: () => true,
  teacherFileExists: async () => true,
  uploadTeacherFile: vi.fn(),
  deleteTeacherFile: vi.fn(),
  getTeacherFileUrl: (key: string) => `https://cdn.example/${key}`,
}))

import { findStoredFile, sanitizeFilename, saveFile } from '@/lib/file-storage'

const NFC = 'Müller.png'.normalize('NFC')
const NFD = 'Müller.png'.normalize('NFD')

const upload = (filename: string, overwrite = false) =>
  saveFile({
    buffer: Buffer.from('x'),
    filename: sanitizeFilename(filename),
    skriptId: 's1',
    userId: 'u1',
    parentId: null,
    contentType: 'image/png',
    overwrite,
  })

const seed = (name: string) =>
  rows.push({ id: 'old', name, skriptId: 's1', parentId: null, isDirectory: false, hash: 'h' })

describe('re-uploading a name that differs only in Unicode form', () => {
  beforeEach(() => {
    rows.length = 0
  })

  it('an NFD upload hits the existing NFC row', async () => {
    seed(NFC)
    await expect(upload(NFD)).rejects.toThrow('File already exists')
    expect(rows).toHaveLength(1)
  })

  it('an NFC upload hits an older NFD row, which keeps its name', async () => {
    seed(NFD)
    await expect(upload(NFC)).rejects.toThrow('File already exists')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe(NFD)
  })

  it('a plain-space upload hits an older U+202F row', async () => {
    seed('Shot AM.png')
    await expect(upload('Shot AM.png')).rejects.toThrow('File already exists')
  })

  it('overwrite updates the older row and returns its stored name', async () => {
    seed(NFD)
    const saved = await upload(NFC, true)
    expect(saved).toMatchObject({ id: 'old', name: NFD })
    expect(rows).toHaveLength(1)
  })

  it('a different name still creates a row', async () => {
    seed(NFC)
    await upload('Maier.png')
    expect(rows).toHaveLength(2)
  })

  it('a rename to the own NFC form is not a collision', async () => {
    seed(NFD)
    expect(await findStoredFile('s1', NFC, { parentId: null, excludeId: 'old' })).toBeNull()
  })
})
