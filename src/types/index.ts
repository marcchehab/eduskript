import { User, Collection, Chapter, Page, PageVersion } from '@prisma/client'

// Extended types with relations
export type UserWithCollections = User & {
  collections: Collection[]
}

export type CollectionWithChapters = Collection & {
  chapters: ChapterWithPages[]
  author: User
}

export type ChapterWithPages = Chapter & {
  pages: PageWithVersions[]
  collection: Collection
}

export type PageWithVersions = Page & {
  versions: PageVersion[]
  chapter: Chapter
}

export type PageWithChapterAndCollection = Page & {
  chapter: Chapter & {
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

export interface CreateChapterData {
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
  chapterId: string
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
  chapters: SidebarChapter[]
}

export interface SidebarChapter {
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
  type: 'collection' | 'chapter' | 'page'
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
