import { User, Topic, Chapter, Page, PageVersion } from '@prisma/client'

// Extended types with relations
export type UserWithTopics = User & {
  topics: Topic[]
}

export type TopicWithChapters = Topic & {
  chapters: ChapterWithPages[]
  author: User
}

export type ChapterWithPages = Chapter & {
  pages: PageWithVersions[]
  topic: Topic
}

export type PageWithVersions = Page & {
  versions: PageVersion[]
  chapter: Chapter
}

export type PageWithChapterAndTopic = Page & {
  chapter: Chapter & {
    topic: Topic
  }
  versions: PageVersion[]
}

// Form types
export interface CreateTopicData {
  title: string
  description?: string
  slug: string
}

export interface CreateChapterData {
  title: string
  description?: string
  slug: string
  order: number
  topicId: string
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

export interface SidebarTopic {
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
  type: 'topic' | 'chapter' | 'page'
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
