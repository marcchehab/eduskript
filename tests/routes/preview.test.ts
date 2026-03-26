import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture notFound/redirect calls
const mockNotFound = vi.fn()
const mockRedirect = vi.fn()

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => { mockNotFound(...args); throw new Error('NOT_FOUND') },
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT') },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/cached-queries', () => ({
  getSkriptForPreview: vi.fn(),
}))

// Mock React components to avoid rendering
vi.mock('@/components/public/layout', () => ({
  PublicSiteLayout: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/markdown/markdown-renderer.server', () => ({
  ServerMarkdownRenderer: () => null,
}))
vi.mock('@/components/public/annotation-wrapper', () => ({
  AnnotationWrapper: ({ children }: { children: React.ReactNode }) => children,
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { getSkriptForPreview } from '@/lib/cached-queries'
import PreviewPage from '@/app/preview/[domain]/[skriptSlug]/[pageSlug]/page'

const TEACHER = {
  id: 'teacher-1',
  email: 'teacher@test.com',
  pageSlug: 'myteacher',
  pageName: 'My Teacher',
  pageDescription: null,
  pageIcon: null,
  name: 'Teacher',
  bio: null,
  title: null,
  sidebarBehavior: 'contextual',
  typographyPreference: 'modern',
}

const OTHER_USER = {
  id: 'other-1',
  email: 'other@test.com',
  pageSlug: 'other',
}

function makeSkriptData(opts: { skriptPublished?: boolean; pagePublished?: boolean } = {}) {
  return {
    id: 'skript-1',
    title: 'Test Skript',
    slug: 'test-skript',
    isPublished: opts.skriptPublished ?? false,
    pages: [{
      id: 'page-1',
      title: 'Test Page',
      slug: 'test-page',
      content: '# Hello',
      order: 1,
      isPublished: opts.pagePublished ?? false,
      pageType: 'normal',
      examSettings: null,
    }],
    collectionSkripts: [{
      collection: {
        id: 'col-1',
        title: 'Test Collection',
        slug: 'test-collection',
      },
    }],
  }
}

function makeParams(overrides: Partial<{ domain: string; skriptSlug: string; pageSlug: string }> = {}) {
  return {
    params: Promise.resolve({
      domain: overrides.domain ?? 'myteacher',
      skriptSlug: overrides.skriptSlug ?? 'test-skript',
      pageSlug: overrides.pageSlug ?? 'test-page',
    }),
  }
}

describe('preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authentication', () => {
    it('should redirect to signin when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      await expect(PreviewPage(makeParams())).rejects.toThrow('REDIRECT')
      expect(mockRedirect).toHaveBeenCalledWith('/auth/signin')
    })

    it('should redirect to signin when session has no user id', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: {}, expires: '' })

      await expect(PreviewPage(makeParams())).rejects.toThrow('REDIRECT')
      expect(mockRedirect).toHaveBeenCalledWith('/auth/signin')
    })
  })

  describe('authorization', () => {
    it('should 404 when teacher pageSlug does not exist', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'teacher-1' },
        expires: '',
      })
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

      await expect(PreviewPage(makeParams({ domain: 'nonexistent' }))).rejects.toThrow('NOT_FOUND')
      expect(mockNotFound).toHaveBeenCalled()
    })

    it('should 404 when authenticated user is not the author (different user)', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: OTHER_USER.id },
        expires: '',
      })
      vi.mocked(prisma.user.findFirst).mockResolvedValue(TEACHER as any)

      await expect(PreviewPage(makeParams())).rejects.toThrow('NOT_FOUND')
      expect(mockNotFound).toHaveBeenCalled()
    })

    it('should allow the author (ID match) to view preview', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: TEACHER.id },
        expires: '',
      })
      vi.mocked(prisma.user.findFirst).mockResolvedValue(TEACHER as any)
      vi.mocked(getSkriptForPreview).mockResolvedValue(makeSkriptData() as any)

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
      expect(mockNotFound).not.toHaveBeenCalled()
      expect(mockRedirect).not.toHaveBeenCalled()
    })
  })

  describe('content lookup', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: TEACHER.id },
        expires: '',
      })
      vi.mocked(prisma.user.findFirst).mockResolvedValue(TEACHER as any)
    })

    it('should 404 when skript does not exist', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(null)

      await expect(PreviewPage(makeParams())).rejects.toThrow('NOT_FOUND')
      expect(mockNotFound).toHaveBeenCalled()
    })

    it('should 404 when page slug does not match any page in skript', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(makeSkriptData() as any)

      await expect(
        PreviewPage(makeParams({ pageSlug: 'nonexistent-page' }))
      ).rejects.toThrow('NOT_FOUND')
    })

    it('should render when skript and page exist', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(makeSkriptData() as any)

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
    })
  })

  describe('publish state handling (no redirect)', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: TEACHER.id },
        expires: '',
      })
      vi.mocked(prisma.user.findFirst).mockResolvedValue(TEACHER as any)
    })

    it('should render without redirect when both skript and page are unpublished', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(
        makeSkriptData({ skriptPublished: false, pagePublished: false }) as any
      )

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
      expect(mockRedirect).not.toHaveBeenCalled()
    })

    it('should render without redirect when skript is unpublished', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(
        makeSkriptData({ skriptPublished: false, pagePublished: true }) as any
      )

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
      expect(mockRedirect).not.toHaveBeenCalled()
    })

    it('should render without redirect when page is unpublished', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(
        makeSkriptData({ skriptPublished: true, pagePublished: false }) as any
      )

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
      expect(mockRedirect).not.toHaveBeenCalled()
    })

    it('should render without redirect when both are published (regression: was redirecting to public URL)', async () => {
      vi.mocked(getSkriptForPreview).mockResolvedValue(
        makeSkriptData({ skriptPublished: true, pagePublished: true }) as any
      )

      const result = await PreviewPage(makeParams())
      expect(result).toBeTruthy()
      // Key assertion: must NOT redirect, which previously caused 404 on localhost
      expect(mockRedirect).not.toHaveBeenCalled()
    })
  })
})
