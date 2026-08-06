/**
 * Tests for resolvePageUrlForUser / parseSkriptAndPageSlugs (src/lib/services/pages.ts).
 * Added so a teacher can hand an AI assistant a pasted URL — dashboard editor,
 * public page, or the /c/ org shorthand — instead of hunting for the page ID
 * via search_my_content.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    skript: { findFirst: vi.fn() },
    page: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  NotFoundError,
  ValidationError,
  parseSkriptAndPageSlugs,
  resolvePageUrlForUser,
} from '@/lib/services/pages'

describe('parseSkriptAndPageSlugs', () => {
  it('parses a dashboard editor URL', () => {
    expect(
      parseSkriptAndPageSlugs(
        'https://informatikgarten.ch/dashboard/skripts/programmieren-1/pages/was-erschaffen-wir/edit'
      )
    ).toEqual({ skriptSlug: 'programmieren-1', pageSlug: 'was-erschaffen-wir' })
  })

  it('parses a dashboard editor URL without the trailing /edit', () => {
    expect(
      parseSkriptAndPageSlugs('/dashboard/skripts/programmieren-1/pages/was-erschaffen-wir')
    ).toEqual({ skriptSlug: 'programmieren-1', pageSlug: 'was-erschaffen-wir' })
  })

  it('parses a public custom-domain URL', () => {
    expect(parseSkriptAndPageSlugs('https://informatikgarten.ch/beispiele/chemie')).toEqual({
      skriptSlug: 'beispiele',
      pageSlug: 'chemie',
    })
  })

  it('parses the eduskript.org /c/ org shorthand', () => {
    expect(parseSkriptAndPageSlugs('https://eduskript.org/c/beispiele/chemie')).toEqual({
      skriptSlug: 'beispiele',
      pageSlug: 'chemie',
    })
  })

  it('parses the eduskript.org full org path (teacherPageSlug/skript/page)', () => {
    expect(parseSkriptAndPageSlugs('https://eduskript.org/marc/beispiele/chemie')).toEqual({
      skriptSlug: 'beispiele',
      pageSlug: 'chemie',
    })
  })

  it('returns null for a skript frontpage URL (no page slug)', () => {
    expect(parseSkriptAndPageSlugs('/dashboard/skripts/programmieren-1/frontpage')).toBeNull()
  })

  it('returns null for a single-segment path', () => {
    expect(parseSkriptAndPageSlugs('/marc')).toBeNull()
  })
})

describe('resolvePageUrlForUser', () => {
  it('resolves a dashboard editor URL to the page', async () => {
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skript-1' } as never)
    vi.mocked(prisma.page.findFirst).mockResolvedValue({ id: 'page-1' } as never)
    vi.mocked(prisma.page.findUnique).mockResolvedValue({
      id: 'page-1',
      title: 'Was erschaffen wir?',
      slug: 'was-erschaffen-wir',
      authors: [{ userId: 'user-1', permission: 'author', user: {} }],
      skript: { id: 'skript-1', title: 'Programmieren 1', slug: 'programmieren-1', authors: [] },
    } as never)

    const page = await resolvePageUrlForUser(
      'user-1',
      '/dashboard/skripts/programmieren-1/pages/was-erschaffen-wir/edit'
    )

    expect(page.id).toBe('page-1')
    expect(vi.mocked(prisma.skript.findFirst).mock.calls[0][0]).toMatchObject({
      where: { slug: 'programmieren-1' },
    })
    expect(vi.mocked(prisma.page.findFirst).mock.calls[0][0]).toMatchObject({
      where: { slug: 'was-erschaffen-wir', skriptId: 'skript-1' },
    })
  })

  it('throws ValidationError when the URL has no slug pair', async () => {
    await expect(resolvePageUrlForUser('user-1', '/marc')).rejects.toBeInstanceOf(
      ValidationError
    )
  })

  it('throws NotFoundError when no matching skript is authored by the user', async () => {
    vi.mocked(prisma.skript.findFirst).mockResolvedValue(null)
    await expect(
      resolvePageUrlForUser('user-1', '/beispiele/chemie')
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the skript has no page with that slug', async () => {
    vi.mocked(prisma.skript.findFirst).mockResolvedValue({ id: 'skript-1' } as never)
    vi.mocked(prisma.page.findFirst).mockResolvedValue(null)
    await expect(
      resolvePageUrlForUser('user-1', '/beispiele/chemie')
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
