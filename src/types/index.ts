import { User, Collection, Skript, Page, PageVersion, CollaborationRequest, Collaboration, CollectionAuthor, SkriptAuthor, PageAuthor } from '@prisma/client'

// Extended types with relations
export type UserWithCollections = User & {
  collections: Collection[]
}

export type CollectionWithSkripts = Collection & {
  skripts: SkriptWithPages[]
  author: User
}

export type SkriptWithPages = Skript & {
  pages: PageWithVersions[]
  collection: Collection
}

export type PageWithVersions = Page & {
  versions: PageVersion[]
  skript: Skript
}

export type PageWithSkriptAndCollection = Page & {
  skript: Skript & {
    collection: Collection
  }
  versions: PageVersion[]
}

// Form types
export interface CreateCollectionData {
  title: string
  description?: string
  slug: string
}

export interface CreateSkriptData {
  title: string
  description?: string
  slug: string
  order: number
  collectionId: string
}

export interface CreatePageData {
  title: string
  slug: string
  content: string
  order: number
  skriptId: string
}

export interface UpdatePageData {
  title?: string
  content?: string
  order?: number
  changeLog?: string
}

// Navigation types
export interface NavItem {
  title: string
  href: string
  description?: string
}

export interface SidebarCollection {
  id: string
  title: string
  slug: string
  skripts: SidebarSkript[]
}

export interface SidebarSkript {
  id: string
  title: string
  slug: string
  pages: SidebarPage[]
}

export interface SidebarPage {
  id: string
  title: string
  slug: string
  isActive?: boolean
}

// Editor types
export interface EditorState {
  content: string
  isDirty: boolean
  lastSaved?: Date
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Search types
export interface SearchResult {
  type: 'collection' | 'skript' | 'page'
  id: string
  title: string
  slug: string
  content?: string
  parentTitle?: string
  parentSlug?: string
}

// Theme types
export type Theme = 'light' | 'dark' | 'system'

// File upload types
export interface UploadedFile {
  filename: string
  originalName: string
  url: string
  size: number
  mimeType: string
}

// Collaboration types
export type CollaborationRequestWithUsers = CollaborationRequest & {
  requester: User
  receiver: User
}

export type CollaborationWithUsers = Collaboration & {
  requester: User
  receiver: User
}

export type UserWithCollaborations = User & {
  sentCollaborationRequests: CollaborationRequestWithUsers[]
  receivedCollaborationRequests: CollaborationRequestWithUsers[]
  collaborationsAsRequester: CollaborationWithUsers[]
  collaborationsAsReceiver: CollaborationWithUsers[]
}

// Form types for collaboration
export interface SendCollaborationRequestData {
  receiverId: string
  message?: string
}

export interface CollaborationRequestResponse {
  id: string
  action: 'accept' | 'reject'
}

// Permission types
export type Permission = 'author' | 'viewer'

export type CollectionWithAuthors = Collection & {
  authors: (CollectionAuthor & { user: User })[]
  skripts?: Array<{
    id: string
    title: string
    slug: string
    description: string | null
    order: number
    isPublished: boolean
    updatedAt: Date
    pages?: Array<{
      id: string
      title: string
      slug: string
      order: number
      isPublished: boolean
      updatedAt: Date
    }>
  }>
}

export type SkriptWithAuthors = Skript & {
  authors: (SkriptAuthor & { user: User })[]
  collection: Collection
}

export type PageWithAuthors = Page & {
  authors: (PageAuthor & { user: User })[]
  skript: Skript & { collection: Collection }
}

// Permission check types
export interface UserPermissions {
  canEdit: boolean
  canView: boolean
  canManageAuthors: boolean
  permission?: Permission
}

// Author management types
export interface AddAuthorData {
  userId: string
  permission: Permission
}

export interface UpdateAuthorData {
  permission: Permission
}
