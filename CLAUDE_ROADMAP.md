**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

*Last updated: 2025-01-15*
*Current Status: User Data Service COMPLETED! Local persistence for annotations and code editor state now available.*

> **Note**: Completed features have been moved to `COMPLETED_FEATURES.md`

---

## 🔧 Recent Infrastructure Improvements (2025-01-15)

**Build Configuration & CI/CD**:
- ✅ **Next.js 16 Migration** - Updated ESLint configuration for Next.js 16
  - Migrated from `next lint` to direct `eslint .` (Next.js 16 removed built-in lint command)
  - Converted ESLint config to flat config format (eslint.config.mjs)
  - Fixed pnpm version mismatch in GitHub Actions workflow
  - Updated TypeScript configuration to exclude test directories from production builds
  - Resolved all 19 ESLint errors (React hooks patterns, variable declarations)
  - Build now passes successfully with zero errors

**Subdomain Routing Fixes**:
- ✅ **Preview Button URL Generation** - Fixed incorrect URL construction in page builder
  - Preview button now correctly generates URLs like `eduadmin.eduskript.org` instead of `eduadmin.org`
  - Properly detects base domain vs subdomain (eduskript.org vs dashboard.eduskript.org)
- ✅ **Native Subdomain Support** - CustomDomainHandler now recognizes `.eduskript.org` subdomains
  - Added detection for both `.eduskript.org` (production) and `.localhost` (development)
  - Automatically rewrites subdomain URLs to `/{subdomain}` path for proper routing
  - Users can now access their pages via `username.eduskript.org` and see correct content

**UI Cleanup**:
- ✅ **Removed Duplicate Footer** - Cleaned up redundant VersionFooter component
  - Kept GitInfo component in bottom right (expandable git commit info)
  - Removed full-width VersionFooter from main page

**User Data Service**:
- ✅ **IndexedDB Persistence Layer** - Created comprehensive local storage system
  - Dexie-based database with compound primary key [pageId, componentId]
  - Singleton service pattern with debounced saves (1 second default)
  - React hook (useUserData) for component integration
  - Type-safe data structures for annotations and code editor state
  - Migrated annotations from old implementation to new service
  - Added code editor persistence (files, settings, canvas transform)
  - Foundation for future remote sync when student accounts exist

**Files Modified**:
- `.github/workflows/ci.yml` - Removed hardcoded pnpm version
- `package.json` - Updated lint script to use eslint directly
- `eslint.config.mjs` - Migrated to flat config format
- `tsconfig.json` - Excluded test/review directories
- `src/components/CustomDomainHandler.tsx` - Added native subdomain detection
- `src/components/dashboard/page-builder-interface.tsx` - Fixed preview URL logic
- `src/app/page.tsx` - Removed duplicate footer
- `src/lib/userdata/` - New user data service directory
  - `types.ts` - TypeScript interfaces for user data
  - `schema.ts` - Dexie database schema
  - `userDataService.ts` - Singleton service with CRUD operations
  - `hooks.ts` - useUserData React hook
- `src/lib/markdown.ts` - Added pageId to MarkdownContext
- `src/components/public/annotatable-content.tsx` - Pass pageId through context
- `src/components/markdown/markdown-renderer.tsx` - Pass pageId to CodeEditor
- `src/components/annotations/annotation-layer.tsx` - Migrated to use new service
- `src/components/public/code-editor/index.tsx` - Added persistence support

---


## 🎯 Priority List (drag to reorder)

**Next up:**
- **Improvements to page editor**: add buttons on top and a indicator that shows which paragraph we're on. sync scroll.
- **Plugin System** - Extensible component architecture, MDX
- **Video Hosting** - Swiss-compliant video upload and embedding
- **Marketplace** - Content selling and customer relationships

**LMS features (later):**
- **Student Accounts** - Class management and progress tracking (unsure: maybe it's even better to NOT have that and simply do sessions - no GDPR relevant data saved. could do exams this way, too)
- **Interactive Quizzes** - In-lesson quizzes with progress tracking

---

# Enhanced Lesson Editor & Student Analytics Roadmap

## 🎨 Phase 1: Enhanced Lesson Editor

### 1.1 Video Hosting Integration
**Goal**: Professional video hosting with Swiss data privacy compliance

**Phase 1.1.1: Provider Research**
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

**Phase 1.1.2: Video Upload Implementation**
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

### 1.2 Interactive Quiz Component
**Goal**: In-lesson quizzes with student progress tracking

**Phase 1.2.1: Quiz Structure Design**
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

**Phase 1.2.2: Quiz Component Implementation**
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

### 1.3 Custom Component Plugin System
**Goal**: Extensible plugin architecture for interactive lesson components

**Phase 1.3.1: Architecture Planning**
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

**Phase 1.3.2: Core Plugin Infrastructure**
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

**Phase 1.3.3: Marketplace Preparation (Future)**
- [ ] Plugin submission and review workflow
- [ ] Public plugin directory
- [ ] Rating and review system
- [ ] Revenue sharing for paid plugins

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

## 🚀 Phase 3: Marketplace Foundation

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
