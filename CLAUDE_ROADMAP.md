**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

*Last updated: 2025-01-07*
*Current Status: Migrating markdown rendering to React-based system with Shiki syntax highlighting. Improving editor preview experience with interactive code blocks.*

## 🔄 Current Work: React Markdown Renderer Migration

### What We're Doing
We're replacing the old HTML-based markdown rendering with a modern React component system that provides better interactivity and maintainability.

**Completed:**
- ✅ Migrated from Next.js 15 `middleware.ts` to Next.js 16 `proxy.ts` convention
- ✅ Fixed unified/remark preset configuration errors
- ✅ Integrated Shiki syntax highlighting with theme awareness (light/dark)
- ✅ Converted markdown renderer to async processing for Shiki compatibility
- ✅ Added interactive code block controls (language dropdown, copy button)
- ✅ Implemented language change with markdown source updates
- ✅ Fixed scroll position preservation during preview re-renders (using useLayoutEffect to capture/restore scroll)
- ✅ Added image captions based on alt text for both regular images and Excalidraw drawings

**Next Tasks:**
- ⏳ Test and refine math rendering (KaTeX)
- ⏳ Polish interactive preview UX (loading states, error handling)

---

# Lesson Editor Enhancements & Student Analytics Roadmap

## Phase 0: Admin User System ✅

**Goal**: The first user to be created should be an administrator that can create, delete and alter existing users, including resetting their password (users should define their new passwords, obviously).

**Completed:**
- ✅ Added `isAdmin` and `requirePasswordReset` fields to User schema
- ✅ Created admin seed script that runs on container startup
- ✅ Default admin user: eduadmin@eduskript.org / letseducate (password reset required)
- ✅ Implemented forced password reset flow
  - Password reset page with validation
  - API endpoint for password updates
  - Dashboard redirect enforcement
- ✅ Admin-only APIs with proper authentication:
  - User CRUD operations (create, read, update, delete)
  - Admin password reset for users
  - Example data seeder
- ✅ Admin panel UI at /dashboard/admin:
  - User management interface
  - Create/edit/delete users
  - Reset user passwords
  - "Insert Example Data" button for demo content
- ✅ Admin panel link in dashboard nav (visible to admins only)

## 🎨 Phase 1: Enhanced Lesson Editor

### 1.1 Excalidraw Integration ✅
**Goal**: Enable teachers to create and embed drawings as themed SVGs
- [x] Research Excalidraw integration approaches
  - [x] Evaluate `@excalidraw/excalidraw` React component
  - [x] Test theming capabilities (light/dark mode support)
  - [x] SVG export functionality
- [x] Design storage strategy
  - [x] Store Excalidraw JSON alongside SVG export with naming: `drawingname.excalidraw`, `drawingname.excalidraw.light.svg`, `drawingname.excalidraw.dark.svg`
  - [x] Use existing file storage system with deduplication
  - [x] Automatic overwrite support for editing
- [x] Implement Excalidraw editor modal
  - [x] Create new component: `src/components/dashboard/excalidraw-editor.tsx`
  - [x] Add toolbar button to markdown editor (Pencil icon)
  - [x] Handle drawing creation/editing workflow
- [x] Implement SVG embedding in markdown
  - [x] Create custom remark plugin for `![[drawingname.excalidraw]]` syntax (`src/lib/remark-plugins/excalidraw-resolver.ts`)
  - [x] Support automatic theme switching (light/dark SVG variants)
  - [x] Integrated into markdown processing pipeline
- [x] Add drawing management UI
  - [x] List drawings in skript file browser with special icon
  - [x] Hide auto-generated SVG files from file list
  - [x] Edit button for existing drawings (orange Pencil icon)
  - [x] Delete/rename functionality through standard file operations
- [x] **Privacy consideration**: Drawings stored on server, no client-side data
- [x] API endpoint: `/api/excalidraw` for saving/loading drawings

### 1.2 Custom Component Plugin System
**Goal**: Extensible plugin architecture for interactive lesson components

**Phase 1.2.1: Architecture Planning**
- [ ] Brainstorm plugin architecture approaches
  - [ ] Sandboxed iframe approach vs. React component registration
  - [ ] Security model (XSS prevention, content security policy)
  - [ ] API surface for plugins (what can they access?)
  - [ ] Plugin manifest format (metadata, permissions, dependencies)
- [ ] Design plugin lifecycle
  - [ ] Discovery and loading mechanism
  - [ ] Registration and validation
  - [ ] Rendering and state management
  - [ ] Hot reloading for development
- [ ] Consider marketplace implications
  - [ ] Plugin versioning and updates
  - [ ] Review/approval process for shared plugins
  - [ ] Licensing model (free vs. paid plugins)
  - [ ] Plugin dependencies and compatibility

**Phase 1.2.2: Core Plugin Infrastructure**
- [ ] Implement plugin loader system
  - [ ] Create plugin registry at `src/lib/plugins/registry.ts`
  - [ ] Plugin manifest schema and validation
  - [ ] Dynamic import mechanism for plugin bundles
- [ ] Build plugin sandbox environment
  - [ ] Isolate plugin execution context
  - [ ] Provide safe API for DOM manipulation
  - [ ] Message passing between host and plugin
- [ ] Create plugin development kit (PDK)
  - [ ] TypeScript types and interfaces
  - [ ] Helper utilities for common tasks
  - [ ] Development mode with hot reload
  - [ ] Example plugin templates
- [ ] Update markdown pipeline
  - [ ] Custom remark/rehype plugin for component blocks
  - [ ] Syntax: ` ```component:plugin-name` code blocks
  - [ ] Props passing and serialization
- [ ] Build plugin management UI
  - [ ] Dashboard section for installed plugins
  - [ ] Enable/disable toggle per skript or globally
  - [ ] Plugin settings/configuration interface

**Phase 1.2.3: Marketplace Preparation (Future)**
- [ ] Plugin submission and review workflow
- [ ] Public plugin directory
- [ ] Rating and review system
- [ ] Revenue sharing for paid plugins

### 1.3 Video Hosting Integration
**Goal**: Professional video hosting with Swiss data privacy compliance

**Phase 1.3.1: Provider Research**
- [ ] Evaluate Mux Video
  - [ ] Pricing and storage limits
  - [ ] Data residency (can data stay in EU/Switzerland?)
  - [ ] Video processing capabilities (adaptive streaming, thumbnails)
  - [ ] Privacy compliance (GDPR, Swiss data protection laws)
- [ ] Research Infomaniak kDrive/kVideo
  - [ ] Available APIs for video upload/streaming
  - [ ] Data residency (Swiss-hosted)
  - [ ] Pricing structure
  - [ ] Features comparison with Mux
- [ ] Research alternative Swiss/EU providers
  - [ ] Swisscom, Cloudflare Stream (EU), bunny.net
  - [ ] Compare features, pricing, and data residency
- [ ] **Decision criteria**:
  - ✅ Data stored in Switzerland or EU
  - ✅ GDPR compliant
  - ✅ Adaptive streaming support
  - ✅ API for upload/playback
  - ✅ Reasonable pricing for educational use

**Phase 1.3.2: Video Upload Implementation**
- [ ] Design video storage model
  - [ ] Add `Video` table to Prisma schema
  - [ ] Track upload status, processing state, provider metadata
  - [ ] Link videos to skripts (similar to file storage)
- [ ] Implement upload flow
  - [ ] Create upload API endpoint: `/api/videos/upload`
  - [ ] Direct upload to provider (avoid server relay)
  - [ ] Progress tracking and error handling
  - [ ] Generate thumbnail from first frame
- [ ] Build video uploader component
  - [ ] Drag-and-drop interface
  - [ ] Upload progress indicator
  - [ ] Video preview after upload
  - [ ] Video management (delete, re-upload)
- [ ] Add video embedding to markdown
  - [ ] Custom remark plugin for `![[video:id]]` syntax
  - [ ] Responsive video player
  - [ ] Playback controls and quality selector
  - [ ] Captions/subtitles support (future)

### 1.4 Interactive Quiz Component
**Goal**: In-lesson quizzes with student progress tracking

**Phase 1.4.1: Quiz Structure Design**
- [ ] Define quiz types
  - [ ] Multiple choice (single/multiple answers)
  - [ ] True/False
  - [ ] Fill in the blank
  - [ ] Short answer (auto-graded with keyword matching)
  - [ ] Code challenges (future: run code and check output)
- [ ] Design quiz storage format
  - [ ] JSON schema for quiz questions and answers
  - [ ] Store as component data in markdown
  - [ ] Version control for quiz content
- [ ] Plan integration with user data service
  - [ ] Submit answers anonymously (zero-knowledge)
  - [ ] Track completion and scores
  - [ ] Allow retry attempts

**Phase 1.4.2: Quiz Component Implementation**
- [ ] Build quiz renderer
  - [ ] Create `src/components/quiz/quiz-renderer.tsx`
  - [ ] Support all question types
  - [ ] Immediate feedback on submission
  - [ ] Show correct answers after submission
- [ ] Build quiz editor
  - [ ] Create `src/components/dashboard/quiz-editor.tsx`
  - [ ] WYSIWYG interface for creating quizzes
  - [ ] Add/remove/reorder questions
  - [ ] Set correct answers and point values
- [ ] Integrate with markdown pipeline
  - [ ] Custom component plugin (uses plugin system from 1.2)
  - [ ] Syntax: ` ```quiz` block with JSON config
  - [ ] Render quiz in public pages
- [ ] Connect to user data service (depends on Phase 2)
  - [ ] Submit quiz responses via API
  - [ ] Store anonymized results
  - [ ] Display student's previous attempts



## 👥 Phase 2: Student Analytics & User Data Service

**Goal**: Enable teachers to create classes, track student progress, while maintaining strict data privacy (zero-knowledge architecture where possible)

### 2.1 Architecture & Privacy Planning
**Critical**: Design for data minimization and privacy by default

- [ ] Research zero-knowledge architectures
  - [ ] Client-side encryption for sensitive student data
  - [ ] What data can be end-to-end encrypted vs. needs server-side access?
  - [ ] Key management (teacher-held keys vs. user-held keys)
- [ ] Define data collection boundaries
  - [ ] **Minimal data**: Progress percentages, completion status, timestamps
  - [ ] **No PII by default**: Anonymous student IDs, no names/emails unless opted-in
  - [ ] **Opt-in for detailed analytics**: Teachers must explicitly request detailed tracking
- [ ] GDPR & Swiss DPA compliance
  - [ ] Data processing agreement (DPA) for schools
  - [ ] Right to deletion (easy data export and purge)
  - [ ] Parental consent workflow for students under 16
  - [ ] Transparent data usage policy
- [ ] Design database schema
  - [ ] `Class` table (teacher-owned groups)
  - [ ] `Student` table (anonymous by default, optional name)
  - [ ] `ClassMembership` junction table
  - [ ] `Progress` table (student, page, completion, score, timestamp)
  - [ ] Encryption at rest for sensitive fields

### 2.2 Class Management System
- [ ] Create class management UI
  - [ ] Dashboard section: `/dashboard/classes`
  - [ ] Create/edit/delete classes
  - [ ] Generate unique join codes for students
  - [ ] Class roster view (anonymized by default)
- [ ] Student enrollment flow
  - [ ] Public join page: `/join/[code]`
  - [ ] Optional: Student creates account vs. anonymous tracking
  - [ ] Parental consent form for minors
  - [ ] Link student to class without storing PII
- [ ] Privacy controls for teachers
  - [ ] Toggle anonymous vs. identified students
  - [ ] Data retention settings (auto-delete after X months)
  - [ ] Export student data (for teacher records)
  - [ ] Bulk delete student data

### 2.3 Progress Tracking System
- [ ] Implement progress tracking API
  - [ ] Endpoint: `/api/progress/track`
  - [ ] Track page views, time spent, completion
  - [ ] Track quiz submissions and scores
  - [ ] Store data with student ID + page ID (no sensitive data)
- [ ] Build progress dashboard for teachers
  - [ ] Class-level overview (completion rates, average scores)
  - [ ] Individual student progress (opt-in only)
  - [ ] Page-level analytics (which pages are hard?)
  - [ ] Quiz performance breakdown
- [ ] Student progress view
  - [ ] Simple page for students: `/my-progress`
  - [ ] Show their own completion percentage
  - [ ] Quiz scores and review wrong answers
  - [ ] No comparison to other students (avoid competition)

### 2.4 Zero-Knowledge Implementation (Optional Enhancement)
**Future**: If full zero-knowledge is desired
- [ ] Client-side encryption for progress data
  - [ ] Teacher generates encryption key on class creation
  - [ ] All progress data encrypted before sending to server
  - [ ] Server stores ciphertext, cannot read data
- [ ] Teacher-side decryption for dashboard
  - [ ] Teacher provides key to view dashboard
  - [ ] Decryption happens in browser
  - [ ] Server never sees plaintext progress data
- [ ] Trade-offs to document
  - [ ] Cannot show aggregated analytics without teacher key
  - [ ] Key loss = data loss (need backup mechanism)
  - [ ] More complex UX for teachers

## 🚀 Phase 3: Enhanced Permission UX

### 1. Access Management Dashboard for Collections
- [x] **Collection-level permission overview** showing who has access to what
- [x] **Clean up the old permission matrix** we no longer use it and went for a simpler UI
- [x] **Individual skript permission settings** use the same interface as collections
- [x] **Edge case**: when removing access to a skript or collection, the removed user will still see them in their page builder but without title. we should instead display a placeholder that says "Your access was revoked. This content can no longer be displayed on your page." on the user's page, we should then no longer display that script or collection!

## 🏪 Phase 4: Marketplace Foundation

### Extended Permission Model
Customers are basically a viewer with a different name and symbol.

```
Current: editor | viewer
Future:  editor | viewer | customer
```

Editors can mark their skripts or collections as "for sale" and set a price, or give them for free.

We'll need to implement a new feature for viewers and customers to be able to create a copy of the skript or collection they have access to that they can edit. We'll then need a cyclical tracking of whether the original has been updated / edited and a mechanism to offer users who copied it a diff-editor to compare changes and merge updates.

We'll integrate a payment provider that handles transactions for purchased content.

We'll need a license agreement that clearly states the uploader must have the right to sell their content.

## 🔒 Security Model: No-Access-By-Default + Ownership Transfer

**Key Principle**: Being a "collaborator" only establishes a relationship - it does NOT grant content access.

**Permission Structure**:
- Junction tables manage permissions: `CollectionAuthor`, `SkriptAuthor`, `PageAuthor`
- `permission = "author"` = edit rights (can modify content)
- `permission = "viewer"` = view rights (read-only access)

**Drag-and-Drop Permission Model**:
- **"Ownership Transfer"** approach (like Google Drive/Dropbox)
- Moving requires edit permissions on BOTH source AND target
- Users automatically get edit rights on moved content if they don't have them
- View-only content cannot be dragged (prevents content theft)

**Access Flow**:
1. Teachers become "collaborators" (partnership established)
2. Content owners explicitly share specific collections/skripts
3. Collaborators can only see content they've been given access to
4. When moving content, automatic permission granting ensures proper ownership
5. Default permission for new content: `none` (no access)

**Benefits**:
- ✅ Privacy by default
- ✅ Granular control over content sharing
- ✅ Secure content movement with automatic permission management
- ✅ Clear audit trail of what's been shared and moved
- ✅ Scalable for marketplace (customers only see purchased content)

## 📝 Implementation Priority

1. **Immediate**: Build access management dashboard for existing collaborators
2. **Next**: Add bulk permission assignment tools
3. **Then**: Create marketplace foundation (customer relationships)
4. **Future**: Advanced analytics and revenue sharing
