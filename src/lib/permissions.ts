import { CollectionAuthor, SkriptAuthor, PageAuthor, User } from '@prisma/client'
import { Permission, UserPermissions } from '@/types'

/**
 * Check user permissions for a collection
 */
export function checkCollectionPermissions(
  userId: string,
  authors: (CollectionAuthor & { user: Partial<User> })[]
): UserPermissions {
  const userAuthor = authors.find(author => author.userId === userId)
  
  if (!userAuthor) {
    return {
      canEdit: false,
      canView: false,
      canManageAuthors: false
    }
  }

  const isAuthor = userAuthor.permission === 'author'
  
  return {
    canEdit: isAuthor,
    canView: true,
    canManageAuthors: isAuthor,
    permission: userAuthor.permission as Permission
  }
}

/**
 * Check user permissions for a skript
 */
export function checkSkriptPermissions(
  userId: string,
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[],
  collectionAuthors: (CollectionAuthor & { user: Partial<User> })[]
): UserPermissions {
  // Check direct skript permissions first
  const userSkriptAuthor = skriptAuthors.find(author => author.userId === userId)
  
  if (userSkriptAuthor) {
    const isAuthor = userSkriptAuthor.permission === 'author'
    return {
      canEdit: isAuthor,
      canView: true,
      canManageAuthors: isAuthor,
      permission: userSkriptAuthor.permission as Permission
    }
  }
  
  // Check collection permissions (inherited)
  const userCollectionAuthor = collectionAuthors.find(author => author.userId === userId)
  
  if (userCollectionAuthor) {
    return {
      canEdit: false, // Collection authors can't edit skripts directly
      canView: true,  // But they can view them
      canManageAuthors: false,
      permission: 'viewer'
    }
  }
  
  return {
    canEdit: false,
    canView: false,
    canManageAuthors: false
  }
}

/**
 * Check user permissions for a page
 */
export function checkPagePermissions(
  userId: string,
  pageAuthors: (PageAuthor & { user: Partial<User> })[],
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[],
  collectionAuthors: (CollectionAuthor & { user: Partial<User> })[]
): UserPermissions {
  // Check direct page permissions first
  const userPageAuthor = pageAuthors.find(author => author.userId === userId)
  
  if (userPageAuthor) {
    const isAuthor = userPageAuthor.permission === 'author'
    return {
      canEdit: isAuthor,
      canView: true,
      canManageAuthors: isAuthor,
      permission: userPageAuthor.permission as Permission
    }
  }
  
  // Check skript permissions (inherited)
  const userSkriptAuthor = skriptAuthors.find(author => author.userId === userId)
  
  if (userSkriptAuthor) {
    const isSkriptAuthor = userSkriptAuthor.permission === 'author'
    return {
      canEdit: isSkriptAuthor, // Skript authors can edit pages
      canView: true,
      canManageAuthors: isSkriptAuthor,
      permission: isSkriptAuthor ? 'author' : 'viewer'
    }
  }
  
  // Check collection permissions (inherited)
  const userCollectionAuthor = collectionAuthors.find(author => author.userId === userId)
  
  if (userCollectionAuthor) {
    return {
      canEdit: false, // Collection authors can't edit pages directly
      canView: true,  // But they can view them
      canManageAuthors: false,
      permission: 'viewer'
    }
  }
  
  return {
    canEdit: false,
    canView: false,
    canManageAuthors: false
  }
}

/**
 * Check if user can remove themselves as an author
 */
export function canRemoveSelfAsAuthor(
  userId: string,
  authors: (CollectionAuthor | SkriptAuthor | PageAuthor)[]
): boolean {
  const authorCount = authors.filter(author => author.permission === 'author').length
  const userIsAuthor = authors.find(author => 
    author.userId === userId && author.permission === 'author'
  )
  
  // Can remove self if they're an author and there's at least one other author
  return Boolean(userIsAuthor && authorCount > 1)
}

/**
 * Get all users who can view a collection (including skripts within it)
 */
export function getCollectionViewers(
  collectionAuthors: (CollectionAuthor & { user: Partial<User> })[]
): Partial<User>[] {
  return collectionAuthors.map(author => author.user)
}

/**
 * Get all users who can view a skript
 */
export function getSkriptViewers(
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[],
  collectionAuthors: (CollectionAuthor & { user: Partial<User> })[]
): Partial<User>[] {
  const skriptUsers = skriptAuthors.map(author => author.user)
  const collectionUsers = collectionAuthors.map(author => author.user)
  
  // Combine and deduplicate
  const allUsers = [...skriptUsers, ...collectionUsers]
  const uniqueUsers = allUsers.filter((user, index, array) => 
    array.findIndex(u => u.id === user.id) === index
  )
  
  return uniqueUsers
}