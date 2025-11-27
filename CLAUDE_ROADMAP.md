**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

*Last updated: 2025-11-25*
*Current Status: Simplified Architecture - Username-Based Routing*

> **Note**: Completed features have been moved to `COMPLETED_FEATURES.md`

---

## 🎯 Priority List

todo: 
- persist snaps
- progress bar doesn't update properly
- add edit link for teachers
- bigger handles for things when using touch (editor)
- ux of annotations (when to activate / deactivate)
- weird on chrome for android

Migration stuff:
- add the strong element from informatikgarten.ch
- in the live preview, color_title 
- **SQL** - port sql.js component to our editor. already done, just check again if it works
- Implement long-press for pen/eraser toolbox (hover doesn't work on iPad). already done, just check again if it works well.

**LMS Features:**
- **Add toggle to classes for teachers to not allow anonymous students**
- **Student Progress Tracking** - Gradebook interface, view progress, grade submissions
- **Interactive Quizzes** - In-lesson quizzes with progress tracking
- **Randomized questions** maybe through special skripts?
- **Teacher abilit to publish annotations**
- **Teacher ability to publsih snaps**
- **Video Hosting** - Swiss-compliant video upload and embedding

**Infrastructure:**
- **Backup System** - Easy database exports and UI to restore if necessary
- **Marketplace / Sharing** - Content sharing and selling platform
- **Plugin System** - Extensible component architecture, MDX support


Very low: Comments by students (maybe per class)

---

## 📝 Notes & Considerations

**Privacy-Preserving Student Identification:**
- Consider if there's a way to identify students without emails leaving the teacher's computer
- (OAuth sends emails all the time, so may not be necessary)

---

## 🔲 Phase 1: Enhanced Lesson Editor

### 1.1 Video Hosting Integration
**Goal**: Professional video hosting with Swiss data privacy compliance

**Phase 1.1.1: Provider Research**
- [ ] Evaluate Mux Video
  - [ ] Pricing and storage limits
  - [ ] Data residency (EU/Switzerland?)
  - [ ] Video processing (adaptive streaming, thumbnails)
  - [ ] Privacy compliance (GDPR, Swiss laws)
- [ ] Research Infomaniak kDrive/kVideo
  - [ ] Available APIs for video upload/streaming
  - [ ] Data residency (Swiss-hosted)
  - [ ] Pricing structure
  - [ ] Features comparison with Mux
- [ ] Research alternative Swiss/EU providers
  - [ ] Swisscom, Cloudflare Stream (EU), bunny.net
  - [ ] Compare features, pricing, data residency
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
  - [ ] Custom component plugin (uses plugin system from 1.3)
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
  - [ ] Security model (XSS prevention, CSP)
  - [ ] API surface for plugins
  - [ ] Plugin manifest format
- [ ] Design plugin lifecycle
  - [ ] Discovery and loading mechanism
  - [ ] Registration and validation
  - [ ] Rendering and state management
  - [ ] Hot reloading for development
- [ ] Consider marketplace implications
  - [ ] Plugin versioning and updates
  - [ ] Review/approval process
  - [ ] Licensing model (free vs. paid)
  - [ ] Plugin dependencies

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

---

## 🔲 Phase 2: Student Analytics & Progress Tracking

**Goal**: Enable teachers to track student progress while maintaining strict data privacy

### 2.1 Gradebook & Progress UI
- [ ] UI for consent flow (first-time student login)
- [ ] Gradebook interface (view progress, grade submissions)
- [ ] Student progress tracking API endpoints
- [ ] Submission management UI

### 2.2 Progress Tracking System
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

### 2.3 Zero-Knowledge Implementation (Optional Enhancement)
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

---

## 🔲 Phase 3: Marketplace Foundation

### Extended Permission Model
Customers are basically a viewer with a different name and symbol.

```
Current: author | viewer
Future:  author | viewer | customer
```

**Features to implement:**
- [ ] Editors can mark skripts/collections as "for sale" and set a price (or give for free)
- [ ] Viewers/customers can create editable copies of shared content
- [ ] Cyclical tracking: notify users when original content is updated
- [ ] Diff-editor to compare changes and merge updates
- [ ] Payment provider integration for purchased content
- [ ] License agreement ensuring uploaders have rights to sell content

---

## 🔒 Security Model: No-Access-By-Default

**Key Principle**: Being a "collaborator" only establishes a relationship - it does NOT grant content access.

**Permission Structure:**
- Junction tables manage permissions: `CollectionAuthor`, `SkriptAuthor`, `PageAuthor`
- `permission = "author"` = edit rights (can modify content)
- `permission = "viewer"` = view rights (read-only access)

**Drag-and-Drop Permission Model:**
- **"Ownership Transfer"** approach (like Google Drive/Dropbox)
- Moving requires edit permissions on BOTH source AND target
- Users automatically get edit rights on moved content if they don't have them
- View-only content cannot be dragged (prevents content theft)

**Access Flow:**
1. Teachers become "collaborators" (partnership established)
2. Content owners explicitly share specific collections/skripts
3. Collaborators can only see content they've been given access to
4. When moving content, automatic permission granting ensures proper ownership
5. Default permission for new content: `none` (no access)

**Benefits:**
- ✅ Privacy by default
- ✅ Granular control over content sharing
- ✅ Secure content movement with automatic permission management
- ✅ Clear audit trail of what's been shared and moved
- ✅ Scalable for marketplace (customers only see purchased content)
