// Core database types (will be replaced with Prisma types after generation)
export interface User {
  id: string
  name?: string | null
  email: string
  emailVerified?: Date | null
  image?: string | null
  hashedPassword?: string | null
  subdomain?: string | null
  bio?: string | null
  title?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Script {
  id: string
  title: string
  description?: string | null
  slug: string
  isPublished: boolean
  authorId: string
  createdAt: Date
  updatedAt: Date
}

export interface Chapter {
  id: string
  title: string
  description?: string | null
  slug: string
  order: number
  isPublished: boolean
  authorId: string
  scriptId: string
  createdAt: Date
  updatedAt: Date
}

export interface Page {
  id: string
  title: string
  slug: string
  content: string
  order: number
  isPublished: boolean
  authorId: string
  chapterId: string
  createdAt: Date
  updatedAt: Date
}

export interface PageVersion {
  id: string
  content: string
  version: number
  changeLog?: string | null
  authorId: string
  pageId: string
  createdAt: Date
}

// Extended types with relations
export type UserWithScripts = User & {
  scripts: Script[]
}

export type ScriptWithChapters = Script & {
  chapters: ChapterWithPages[]
  author: User
}

export type ChapterWithPages = Chapter & {
  pages: PageWithVersions[]
  script: Script
}

export type PageWithVersions = Page & {
  versions: PageVersion[]
  chapter: Chapter
}

export type PageWithChapterAndScript = Page & {
  chapter: Chapter & {
    script: Script
  }
  versions: PageVersion[]
}

// Form types
export interface CreateScriptData {
  title: string
  description?: string
  slug: string
}

export interface CreateChapterData {
  title: string
  description?: string
  slug: string
  order: number
  scriptId: string
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

export interface SidebarScript {
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
  type: 'script' | 'chapter' | 'page'
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
