export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export interface ChatRequest {
  skriptId: string
  pageId?: string // Optional: focus on specific page
  messages: ChatMessage[]
}

export interface ChatStreamEvent {
  type: 'content' | 'error' | 'done'
  content?: string
  error?: string
}

export interface SkriptContext {
  skript: {
    id: string
    title: string
    description: string | null
    slug: string
    isPublished: boolean
  }
  pages: Array<{
    id: string
    title: string
    slug: string
    content: string
    order: number
    isPublished: boolean
  }>
  files: Array<{
    id: string
    name: string
    contentType: string | null
  }>
  focusedPageId?: string
}

export interface AISystemPromptConfig {
  orgPrompt?: string
  skriptContext: SkriptContext
}

// Edit proposal types for structured content changes
export interface PageEdit {
  pageId: string | null // null for new pages
  pageTitle: string
  pageSlug: string
  originalContent: string // empty string for new pages
  proposedContent: string
  summary: string // Brief description of what changed
  isNew?: boolean // true if this is a new page to create
}

export interface EditProposal {
  skriptId: string
  edits: PageEdit[]
  overallSummary: string // High-level description of all changes
}

// EditRequest: exactly one of skriptId or frontPageId must be set.
// - skriptId mode: edit one or more pages in a skript (multi-page proposal)
// - frontPageId mode: edit a single FrontPage content blob (single-edit proposal)
export interface EditRequest {
  skriptId?: string
  pageId?: string // Optional: focus edits on specific page (skript mode only)
  frontPageId?: string // When set, edits the FrontPage's content instead of a skript
  instruction: string
}

export interface EditResponse {
  success: boolean
  proposal?: EditProposal
  error?: string
}
