import { User, Collection, Skript, Page, PageVersion } from '@prisma/client'

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
