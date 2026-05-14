import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: { findMany: vi.fn() },
    skript: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { hydratePageLayoutItems, type LayoutItemRow, type LayoutViewer } from '@/lib/page-layout'

const viewer: LayoutViewer = { userId: 'user-1', isAdmin: false, orgRoles: [] }

// Minimal collection/skript rows shaped like the Prisma includes.
function collectionRow(id: string, opts: {
  ownerId?: string
  orgId?: string
  skripts?: { id: string; authorId: string; order?: number }[]
} = {}) {
  return {
    id,
    title: `Collection ${id}`,
    accentColor: null,
    site: { userId: opts.ownerId ?? null, organizationId: opts.orgId ?? null },
    collectionSkripts: (opts.skripts ?? []).map((s, i) => ({
      order: s.order ?? i,
      skript: {
        id: s.id,
        title: `Skript ${s.id}`,
        description: null,
        slug: s.id,
        isPublished: true,
        isUnlisted: false,
        authors: [{ userId: s.authorId, permission: 'author', user: { id: s.authorId } }],
      },
    })),
  }
}

function skriptRow(id: string, authorId: string) {
  return {
    id,
    title: `Skript ${id}`,
    description: null,
    slug: id,
    isPublished: true,
    isUnlisted: false,
    authors: [{ userId: authorId, permission: 'author', user: { id: authorId } }],
  }
}

describe('hydratePageLayoutItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.collection.findMany).mockResolvedValue([])
    vi.mocked(prisma.skript.findMany).mockResolvedValue([])
  })

  it('hydrates a collection with its skripts and permissions', async () => {
    vi.mocked(prisma.collection.findMany).mockResolvedValue([
      collectionRow('c1', { ownerId: 'user-1', skripts: [{ id: 's1', authorId: 'user-1' }] }),
    ] as unknown as Awaited<ReturnType<typeof prisma.collection.findMany>>)

    const items: LayoutItemRow[] = [{ type: 'collection', contentId: 'c1', order: 0 }]
    const result = await hydratePageLayoutItems(items, viewer)

    expect(result).toHaveLength(1)
    const col = result[0]
    expect(col).toMatchObject({
      id: 'c1',
      type: 'collection',
      order: 0,
      permissions: { canEdit: true, canView: true }, // viewer owns the site
    })
    expect(col.type === 'collection' && col.skripts[0]).toMatchObject({
      id: 's1',
      type: 'skript',
      parentId: 'c1',
      isInLayout: true,
      permissions: { canEdit: true, canView: true }, // viewer authors the skript
    })
  })

  it('marks collection not-editable when viewer neither owns nor admins the site', async () => {
    vi.mocked(prisma.collection.findMany).mockResolvedValue([
      collectionRow('c1', { ownerId: 'someone-else', skripts: [{ id: 's1', authorId: 'someone-else' }] }),
    ] as unknown as Awaited<ReturnType<typeof prisma.collection.findMany>>)

    const result = await hydratePageLayoutItems(
      [{ type: 'collection', contentId: 'c1', order: 0 }],
      viewer,
    )
    const col = result[0]
    expect(col.permissions).toEqual({ canEdit: false, canView: true })
    // viewer is not an author of the nested skript
    expect(col.type === 'collection' && col.skripts[0].permissions).toEqual({
      canEdit: false,
      canView: false,
    })
  })

  it('hydrates a root skript', async () => {
    vi.mocked(prisma.skript.findMany).mockResolvedValue([
      skriptRow('s1', 'user-1'),
    ] as unknown as Awaited<ReturnType<typeof prisma.skript.findMany>>)

    const result = await hydratePageLayoutItems(
      [{ type: 'skript', contentId: 's1', order: 0 }],
      viewer,
    )
    expect(result).toEqual([
      expect.objectContaining({
        id: 's1',
        type: 'skript',
        order: 0,
        permissions: { canEdit: true, canView: true },
      }),
    ])
  })

  it('drops orphan layout rows whose content no longer exists', async () => {
    // prisma returns nothing for the referenced ids
    const result = await hydratePageLayoutItems(
      [
        { type: 'collection', contentId: 'gone-c', order: 0 },
        { type: 'skript', contentId: 'gone-s', order: 1 },
      ],
      viewer,
    )
    expect(result).toEqual([])
  })

  it('keeps a skript only inside its collection, not also as a root item', async () => {
    vi.mocked(prisma.collection.findMany).mockResolvedValue([
      collectionRow('c1', { ownerId: 'user-1', skripts: [{ id: 's1', authorId: 'user-1' }] }),
    ] as unknown as Awaited<ReturnType<typeof prisma.collection.findMany>>)
    vi.mocked(prisma.skript.findMany).mockResolvedValue([
      skriptRow('s1', 'user-1'),
    ] as unknown as Awaited<ReturnType<typeof prisma.skript.findMany>>)

    const result = await hydratePageLayoutItems(
      [
        { type: 'collection', contentId: 'c1', order: 0 },
        { type: 'skript', contentId: 's1', order: 1 }, // also pinned at root
      ],
      viewer,
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('collection')
  })

  it('admin viewer can edit everything', async () => {
    vi.mocked(prisma.collection.findMany).mockResolvedValue([
      collectionRow('c1', { ownerId: 'someone-else', skripts: [{ id: 's1', authorId: 'someone-else' }] }),
    ] as unknown as Awaited<ReturnType<typeof prisma.collection.findMany>>)

    const result = await hydratePageLayoutItems(
      [{ type: 'collection', contentId: 'c1', order: 0 }],
      { userId: 'user-1', isAdmin: true, orgRoles: [] },
    )
    const col = result[0]
    expect(col.permissions.canEdit).toBe(true)
    expect(col.type === 'collection' && col.skripts[0].permissions.canEdit).toBe(true)
  })
})
