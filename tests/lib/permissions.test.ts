import { describe, it, expect } from 'vitest'
import {
  checkCollectionPermissions,
  checkSkriptPermissions,
  checkPagePermissions,
} from '@/lib/permissions'

describe('lib/permissions', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }

  const mockOtherUser = {
    id: 'user-2',
    email: 'other@example.com',
    name: 'Other User',
  }

  describe('checkCollectionPermissions', () => {
    it('should grant edit permissions to author', () => {
      const authors = [
        {
          id: '1',
          userId: mockUser.id,
          collectionId: 'col-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkCollectionPermissions(mockUser.id, authors)

      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('should grant view-only permissions to viewer', () => {
      const authors = [
        {
          id: '1',
          userId: mockUser.id,
          collectionId: 'col-1',
          permission: 'viewer' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkCollectionPermissions(mockUser.id, authors)

      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(false)
      expect(result.permission).toBe('viewer')
    })

    it('should deny all permissions to non-author', () => {
      const authors = [
        {
          id: '1',
          userId: mockOtherUser.id,
          collectionId: 'col-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockOtherUser,
        },
      ]

      const result = checkCollectionPermissions(mockUser.id, authors)

      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(false)
      expect(result.canManageAuthors).toBe(false)
      expect(result.permission).toBeUndefined()
    })
  })

  describe('checkSkriptPermissions', () => {
    it('should grant edit permissions to direct skript author', () => {
      const skriptAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          skriptId: 'skript-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkSkriptPermissions(mockUser.id, skriptAuthors)

      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('should grant view-only to skript viewer', () => {
      const skriptAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          skriptId: 'skript-1',
          permission: 'viewer' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkSkriptPermissions(mockUser.id, skriptAuthors)

      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(false)
      expect(result.permission).toBe('viewer')
    })

    it('should grant view permissions to collection author (inherited)', () => {
      const skriptAuthors: any[] = []
      const collectionAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          collectionId: 'col-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkSkriptPermissions(mockUser.id, skriptAuthors, collectionAuthors)

      expect(result.canEdit).toBe(false) // Collection authors can't edit skripts
      expect(result.canView).toBe(true)  // But they can view them
      expect(result.canManageAuthors).toBe(false)
      expect(result.permission).toBe('viewer')
    })

    it('should deny all permissions when not authorized', () => {
      const skriptAuthors: any[] = []
      const collectionAuthors: any[] = []

      const result = checkSkriptPermissions(mockUser.id, skriptAuthors, collectionAuthors)

      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(false)
      expect(result.canManageAuthors).toBe(false)
    })
  })

  describe('checkPagePermissions', () => {
    it('should grant edit permissions to direct page author', () => {
      const pageAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          pageId: 'page-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkPagePermissions(mockUser.id, pageAuthors, [], [])

      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('should grant edit permissions to skript author (inherited)', () => {
      const pageAuthors: any[] = []
      const skriptAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          skriptId: 'skript-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkPagePermissions(mockUser.id, pageAuthors, skriptAuthors, [])

      expect(result.canEdit).toBe(true) // Skript authors can edit pages
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('should grant view permissions to collection author (inherited)', () => {
      const pageAuthors: any[] = []
      const skriptAuthors: any[] = []
      const collectionAuthors = [
        {
          id: '1',
          userId: mockUser.id,
          collectionId: 'col-1',
          permission: 'author' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: mockUser,
        },
      ]

      const result = checkPagePermissions(mockUser.id, pageAuthors, skriptAuthors, collectionAuthors)

      expect(result.canEdit).toBe(false) // Collection authors can't edit pages
      expect(result.canView).toBe(true)  // But they can view them
      expect(result.canManageAuthors).toBe(false)
      expect(result.permission).toBe('viewer')
    })
  })
})
