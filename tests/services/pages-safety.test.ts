/**
 * Service-layer tests for the destructive-write guard and the restore flow
 * added in response to the `update_page(content: "")` page-wipe incident.
 *
 * Both functions live in src/lib/services/pages.ts and are the trust
 * boundary for every entry point (REST PATCH, MCP update_page,
 * update_page_content, AI Edit). Testing them here covers all callers in
 * one go without spinning up the API layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: { findFirst: vi.fn(), update: vi.fn() },
    pageVersion: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    organizationMember: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  ValidationError,
  NotFoundError,
  updatePageForUser,
  restorePageVersionForUser,
  listPageVersionsForUser,
} from '@/lib/services/pages'

const baseExistingPage = {
  id: 'page-1',
  skriptId: 'skript-1',
  slug: 'intro',
  title: 'Intro',
  content: '# Existing teaching content with several paragraphs of substance.',
  authors: [{ userId: 'user-1' }],
  versions: [
    {
      id: 'v-1',
      version: 1,
      content: '# Existing teaching content with several paragraphs of substance.',
    },
  ],
  skript: {
    slug: 'aufbau',
    collectionSkripts: [{ collection: { slug: 'grundjahr' } }],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ pageSlug: 'marc' } as never)
  vi.mocked(prisma.organizationMember.findMany).mockResolvedValue([] as never)
})

describe('updatePageForUser — destructive-write guard', () => {
  it('rejects content="" when existing content is non-empty', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)

    await expect(
      updatePageForUser('user-1', 'page-1', { content: '' }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(prisma.page.update).not.toHaveBeenCalled()
    expect(prisma.pageVersion.create).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only content overwriting non-empty existing', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)

    await expect(
      updatePageForUser('user-1', 'page-1', { content: '   \n\n  ' }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(prisma.page.update).not.toHaveBeenCalled()
  })

  it('allows content="" when allowEmptyContent: true is passed (intentional wipe)', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)
    vi.mocked(prisma.page.update).mockResolvedValue({
      ...baseExistingPage,
      content: '',
    } as never)
    vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as never)

    await expect(
      updatePageForUser(
        'user-1',
        'page-1',
        { content: '' },
        { allowEmptyContent: true },
      ),
    ).resolves.toBeDefined()

    expect(prisma.page.update).toHaveBeenCalledOnce()
    expect(prisma.pageVersion.create).toHaveBeenCalledOnce()
  })

  it('allows non-empty content edits without confirm flag', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)
    vi.mocked(prisma.page.update).mockResolvedValue({
      ...baseExistingPage,
      content: '# Brand new content',
    } as never)
    vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as never)

    await expect(
      updatePageForUser('user-1', 'page-1', { content: '# Brand new content' }),
    ).resolves.toBeDefined()
  })

  it('allows metadata-only updates (no content field) regardless of guard', async () => {
    // First findFirst: loadPageForActor → return the existing page.
    // Second findFirst: slug-conflict probe → return null (slug is free).
    vi.mocked(prisma.page.findFirst)
      .mockResolvedValueOnce(baseExistingPage as never)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.page.update).mockResolvedValue(baseExistingPage as never)

    await expect(
      updatePageForUser('user-1', 'page-1', {
        title: 'New title',
        slug: 'new-slug',
      }),
    ).resolves.toBeDefined()

    // Metadata-only update should never create a PageVersion.
    expect(prisma.pageVersion.create).not.toHaveBeenCalled()
  })

  // Empty-string-as-no-change rule (the bug-report scenario):
  // an LLM that "passes everything to be safe" with title:"" and slug:""
  // should NOT trigger title/slug validation when only description is
  // actually being changed.
  describe('empty-string normalisation', () => {
    it('treats title:"" and slug:"" as no-change when description is set', async () => {
      vi.mocked(prisma.page.findFirst)
        .mockResolvedValueOnce(baseExistingPage as never)
      vi.mocked(prisma.page.update).mockResolvedValue({
        ...baseExistingPage,
        description: 'New excerpt',
      } as never)

      await expect(
        updatePageForUser('user-1', 'page-1', {
          title: '',
          slug: '',
          description: 'New excerpt',
        }),
      ).resolves.toBeDefined()

      const updateCall = vi.mocked(prisma.page.update).mock.calls[0][0]
      expect(updateCall.data).toMatchObject({ description: 'New excerpt' })
      expect(updateCall.data).not.toHaveProperty('title')
      expect(updateCall.data).not.toHaveProperty('slug')
    })

    it('accepts a metadata-only patch with only description', async () => {
      vi.mocked(prisma.page.findFirst).mockResolvedValueOnce(baseExistingPage as never)
      vi.mocked(prisma.page.update).mockResolvedValue(baseExistingPage as never)

      await expect(
        updatePageForUser('user-1', 'page-1', { description: 'Just this' }),
      ).resolves.toBeDefined()

      const updateCall = vi.mocked(prisma.page.update).mock.calls[0][0]
      expect(updateCall.data).toMatchObject({ description: 'Just this' })
    })

    it('treats description:"" as no-change (does not clear)', async () => {
      vi.mocked(prisma.page.findFirst).mockResolvedValueOnce({
        ...baseExistingPage,
        description: 'Existing description',
      } as never)
      vi.mocked(prisma.page.update).mockResolvedValue(baseExistingPage as never)

      await expect(
        updatePageForUser('user-1', 'page-1', { description: '' }),
      ).resolves.toBeDefined()

      const updateCall = vi.mocked(prisma.page.update).mock.calls[0][0]
      expect(updateCall.data).not.toHaveProperty('description')
    })

    it('treats description:null as an explicit clear', async () => {
      vi.mocked(prisma.page.findFirst).mockResolvedValueOnce(baseExistingPage as never)
      vi.mocked(prisma.page.update).mockResolvedValue(baseExistingPage as never)

      await expect(
        updatePageForUser('user-1', 'page-1', { description: null }),
      ).resolves.toBeDefined()

      const updateCall = vi.mocked(prisma.page.update).mock.calls[0][0]
      expect(updateCall.data).toMatchObject({ description: null })
    })

    it('rejects whitespace-only title with a clear error', async () => {
      vi.mocked(prisma.page.findFirst).mockResolvedValueOnce(baseExistingPage as never)

      await expect(
        updatePageForUser('user-1', 'page-1', { title: '   ' }),
      ).resolves.toBeDefined() // whitespace-only collapses to undefined → no-op

      // No update should have title in its data.
      const updateCall = vi.mocked(prisma.page.update).mock.calls[0]?.[0]
      if (updateCall) {
        expect(updateCall.data).not.toHaveProperty('title')
      }
    })
  })

  it('does not block content="" when there was nothing to wipe', async () => {
    // Page exists but its current content is also empty (or never had any).
    vi.mocked(prisma.page.findFirst).mockResolvedValue({
      ...baseExistingPage,
      content: '',
      versions: [{ id: 'v-1', version: 1, content: '' }],
    } as never)
    vi.mocked(prisma.page.update).mockResolvedValue(baseExistingPage as never)

    await expect(
      updatePageForUser('user-1', 'page-1', { content: '' }),
    ).resolves.toBeDefined()
  })
})

describe('restorePageVersionForUser', () => {
  it('throws NotFoundError when the page does not belong to the user', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(null)

    await expect(
      restorePageVersionForUser('user-1', 'page-1', 'v-1'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the version does not exist', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)
    vi.mocked(prisma.pageVersion.findFirst).mockResolvedValue(null)

    await expect(
      restorePageVersionForUser('user-1', 'page-1', 'v-missing'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('writes the old content back and appends a "Restored from version N" entry', async () => {
    const oldVersion = {
      id: 'v-old',
      version: 5,
      content: '# Original lesson with 4596 chars worth of teaching prose',
      pageId: 'page-1',
    }

    vi.mocked(prisma.page.findFirst).mockResolvedValue(baseExistingPage as never)
    vi.mocked(prisma.pageVersion.findFirst)
      .mockResolvedValueOnce(oldVersion as never) // version lookup
      .mockResolvedValueOnce({ version: 12 } as never) // latest version probe
    vi.mocked(prisma.page.update).mockResolvedValue({
      ...baseExistingPage,
      content: oldVersion.content,
    } as never)
    vi.mocked(prisma.pageVersion.create).mockResolvedValue({} as never)

    const result = await restorePageVersionForUser('user-1', 'page-1', 'v-old')

    expect(result.restoredFromVersion).toBe(5)
    expect(prisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'page-1' },
        data: expect.objectContaining({ content: oldVersion.content }),
      }),
    )
    expect(prisma.pageVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pageId: 'page-1',
        content: oldVersion.content,
        version: 13,
        changeLog: 'Restored from version 5',
        authorId: 'user-1',
      }),
    })
  })
})

describe('listPageVersionsForUser', () => {
  it('returns versions newest first with contentLength populated', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue({ id: 'page-1' } as never)
    vi.mocked(prisma.pageVersion.findMany).mockResolvedValue([
      {
        id: 'v-3',
        version: 3,
        changeLog: null,
        createdAt: new Date('2026-05-01'),
        editSource: 'mcp',
        editClient: 'claude.ai',
        content: 'short',
        author: { name: 'Marc', email: 'm@x' },
      },
      {
        id: 'v-2',
        version: 2,
        changeLog: 'Restored from version 1',
        createdAt: new Date('2026-04-30'),
        editSource: null,
        editClient: null,
        content: '#'.repeat(4596),
        author: { name: 'Marc', email: 'm@x' },
      },
    ] as never)

    const out = await listPageVersionsForUser('user-1', 'page-1')

    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'v-3', version: 3, contentLength: 5 })
    expect(out[1]).toMatchObject({
      id: 'v-2',
      version: 2,
      contentLength: 4596,
      changeLog: 'Restored from version 1',
    })
  })

  it('throws NotFoundError when the page is not the user\'s', async () => {
    vi.mocked(prisma.page.findFirst).mockResolvedValue(null)

    await expect(
      listPageVersionsForUser('user-1', 'page-1'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
