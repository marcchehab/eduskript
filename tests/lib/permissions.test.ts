import { describe, it, expect } from 'vitest'
import {
  canEditSite,
  checkCollectionPermissions,
  checkSkriptPermissions,
  checkPagePermissions,
  canRemoveSelfAsAuthor,
  getSkriptViewers,
} from '@/lib/permissions'

describe('lib/permissions', () => {
  const userA = 'user-A'
  const userB = 'user-B'
  const orgId = 'org-1'

  describe('canEditSite', () => {
    it('grants edit when user owns the site', () => {
      expect(canEditSite(userA, { userId: userA, organizationId: null })).toBe(true)
    })

    it('denies when user does not own the site', () => {
      expect(canEditSite(userA, { userId: userB, organizationId: null })).toBe(false)
    })

    it('grants edit to org owner/admin', () => {
      const site = { userId: null, organizationId: orgId }
      expect(canEditSite(userA, site, [{ organizationId: orgId, role: 'owner' }])).toBe(true)
      expect(canEditSite(userA, site, [{ organizationId: orgId, role: 'admin' }])).toBe(true)
    })

    it('denies plain org members', () => {
      const site = { userId: null, organizationId: orgId }
      expect(canEditSite(userA, site, [{ organizationId: orgId, role: 'member' }])).toBe(false)
    })

    it('grants edit to isAdmin regardless of ownership', () => {
      expect(canEditSite(userA, { userId: userB, organizationId: null }, [], true)).toBe(true)
    })

    it('denies when site is null/undefined', () => {
      expect(canEditSite(userA, null)).toBe(false)
      expect(canEditSite(userA, undefined)).toBe(false)
    })
  })

  describe('checkCollectionPermissions', () => {
    it('grants edit + view when user owns the collection site', () => {
      const result = checkCollectionPermissions(userA, {
        site: { userId: userA, organizationId: null },
      })
      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(false) // collections no longer have authors
    })

    it('denies non-owner', () => {
      const result = checkCollectionPermissions(userA, {
        site: { userId: userB, organizationId: null },
      })
      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(false)
    })

    it('grants org admin', () => {
      const result = checkCollectionPermissions(
        userA,
        { site: { userId: null, organizationId: orgId } },
        [{ organizationId: orgId, role: 'admin' }]
      )
      expect(result.canEdit).toBe(true)
    })
  })

  describe('checkSkriptPermissions', () => {
    const authorRow = (userId: string, permission: 'author' | 'viewer') => ({
      id: `sa-${userId}`,
      skriptId: 'skript-1',
      userId,
      permission,
      createdAt: new Date(),
      user: { id: userId },
    })

    it('grants edit + manage to direct skript author', () => {
      const result = checkSkriptPermissions(userA, [authorRow(userA, 'author')])
      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('grants view-only to skript viewer', () => {
      const result = checkSkriptPermissions(userA, [authorRow(userA, 'viewer')])
      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(false)
    })

    it('denies users without a SkriptAuthor row', () => {
      const result = checkSkriptPermissions(userA, [authorRow(userB, 'author')])
      expect(result.canView).toBe(false)
    })

    it('grants everything to isAdmin', () => {
      const result = checkSkriptPermissions(userA, [], true)
      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
      expect(result.canManageAuthors).toBe(true)
    })
  })

  describe('checkPagePermissions', () => {
    const pageAuthorRow = (userId: string, permission: 'author' | 'viewer') => ({
      id: `pa-${userId}`,
      pageId: 'page-1',
      userId,
      permission,
      createdAt: new Date(),
      user: { id: userId },
    })
    const skriptAuthorRow = (userId: string, permission: 'author' | 'viewer') => ({
      id: `sa-${userId}`,
      skriptId: 'skript-1',
      userId,
      permission,
      createdAt: new Date(),
      user: { id: userId },
    })

    it('grants edit via direct PageAuthor', () => {
      const result = checkPagePermissions(userA, [pageAuthorRow(userA, 'author')], [])
      expect(result.canEdit).toBe(true)
      expect(result.permission).toBe('author')
    })

    it('inherits edit from SkriptAuthor when no PageAuthor', () => {
      const result = checkPagePermissions(userA, [], [skriptAuthorRow(userA, 'author')])
      expect(result.canEdit).toBe(true)
      expect(result.canView).toBe(true)
    })

    it('inherits view-only from SkriptAuthor viewer', () => {
      const result = checkPagePermissions(userA, [], [skriptAuthorRow(userA, 'viewer')])
      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(true)
    })

    it('denies users with neither', () => {
      const result = checkPagePermissions(userA, [], [])
      expect(result.canView).toBe(false)
    })

    it('PageAuthor overrides SkriptAuthor — even when restricting', () => {
      const result = checkPagePermissions(
        userA,
        [pageAuthorRow(userA, 'viewer')],
        [skriptAuthorRow(userA, 'author')]
      )
      expect(result.canEdit).toBe(false)
      expect(result.canView).toBe(true)
    })
  })

  describe('canRemoveSelfAsAuthor', () => {
    const row = (userId: string, permission: 'author' | 'viewer') => ({
      id: `r-${userId}`,
      skriptId: 'skript-1',
      userId,
      permission,
      createdAt: new Date(),
    })

    it('allows removal when more than one author remains', () => {
      expect(canRemoveSelfAsAuthor(userA, [row(userA, 'author'), row(userB, 'author')])).toBe(true)
    })

    it('blocks removal when user is the last author', () => {
      expect(canRemoveSelfAsAuthor(userA, [row(userA, 'author'), row(userB, 'viewer')])).toBe(false)
    })

    it('returns false when user is not an author', () => {
      expect(canRemoveSelfAsAuthor(userA, [row(userB, 'author')])).toBe(false)
    })
  })

  describe('getSkriptViewers', () => {
    it('returns the users attached to each SkriptAuthor row', () => {
      const userOne = { id: userA, name: 'A' }
      const userTwo = { id: userB, name: 'B' }
      const result = getSkriptViewers([
        { id: 'r1', skriptId: 's', userId: userA, permission: 'author', createdAt: new Date(), user: userOne },
        { id: 'r2', skriptId: 's', userId: userB, permission: 'viewer', createdAt: new Date(), user: userTwo },
      ])
      expect(result).toEqual([userOne, userTwo])
    })
  })
})
