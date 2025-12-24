**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

*Last updated: 2025-12-23*
*Current Status: Production Migration in Progress*

> **Note**: Completed features have been moved to `docs/COMPLETED_FEATURES.md`

---

## 🚀 IMMEDIATE: Production Migration

**Goal**: Get production running with informatikgarten content migrated to eduskript

**Strategy**: Import to local dev DB, test thoroughly, then `pg_dump` to production (exact copy, no migration issues)

### Step 1: Export Informatikgarten Content
- [ ] Re-export informatikgarten data (content has been updated since last export)
- [ ] Export format: JSON with collections, skripts, pages, files
- [ ] Include file references and media assets
- [ ] Verify export completeness

### Step 2: Import to Local Dev Database
- [ ] Ensure local PostgreSQL is running (`pnpm db:local`)
- [ ] Reset local DB to clean state (`pnpm db:reset` or fresh `db push`)
- [ ] Create/update import script for eduskript schema
- [ ] Map informatikgarten structure to eduskript models:
  - Collections → Collections
  - Scripts → Skripts
  - Pages → Pages
  - Files → File storage with deduplication
- [ ] Handle user creation (eduadmin as owner)
- [ ] Run import script against local dev DB
- [ ] Migrate file assets to Scaleway storage (or keep existing bucket)

### Step 3: Local Verification
- [ ] Start dev server (`pnpm dev`)
- [ ] Test all imported content renders correctly
- [ ] Verify markdown processing (code blocks, math, images, Excalidraw)
- [ ] Check file/image URLs resolve correctly
- [ ] Test navigation and routing
- [ ] Verify SQL editors with database files work
- [ ] Test annotations work on imported pages

### Step 4: Copy to Production (pg_dump)
- [ ] Reset/recreate Koyeb production database (empty slate)
- [ ] Export local dev DB:
  ```bash
  pg_dump postgresql://postgres:postgres@localhost:5432/eduskript_dev > dump.sql
  ```
- [ ] Import to production:
  ```bash
  psql $KOYEB_DATABASE_URL < dump.sql
  ```
- [ ] Verify production site works

### Step 5: Go-Live Verification
- [ ] Test production site end-to-end
- [ ] Verify login/auth works
- [ ] Check all content accessible
- [ ] Test on mobile/tablet
- [ ] Monitor for errors

---

## 🐛 Known Bugs (Priority Order)

### Major
- **Safari iPad snap freeze** - When using snap feature, freezes after border animation for ~30 seconds, then shows snap with wrong font and no annotations

### Minor
- **Org frontpage cache invalidation** - Updated frontpage may still show old version (ISR cache issue)

### Unconfirmed
- **Session state after logout** - (Partially fixed) Enabled `refetchOnWindowFocus` to prevent stale sessions between tabs

---

## 🎯 Active Feature Development

### Safe Exam Browser (SEB) Integration
*Most features complete, remaining work:*
- 🔲 Switch to see what students are doing (like annotation system)
- 🔲 After-exam teacher UX (correct/view exam, points overview)
- 🔲 SEB security: upgrade from spoofable user agent to BEK validation

### Annotation System Polish
*Core system complete, UX improvements needed:*
- 🔲 Improve annotation UX - feels laggy on iPad, pressure curve may be off
- 🔲 "Reading mode" toggle for responsive text without annotations
- 🔲 Scrolling improvements (momentum/inertia, center alignment when zoomed out)
- 🔲 Delta updates for strokes (see `docs/`)

---

## 📋 Backlog by Category

### LMS Features
- **Interactive Quizzes** - In-lesson quizzes with progress tracking (existing `<Question>` component has live answers)
- **Student Progress Tracking** - Gradebook interface, view progress, grade submissions
- **Randomized question/exercise pages** - Special skripts serving randomized pages per day/week
- **Exam pages** - Pages that are exams, unlockable for specific classes
- **Grading with points** - Annotation feedback system with points per question

### Infrastructure
- **Backup System** - Easy database exports and UI to restore
- **Marketplace / Sharing** - Content sharing and selling platform
- **Plugin System** - Extensible component architecture, MDX support
- **Full text search**

### Small Improvements
- Bigger handles for resize bars in editor on touch devices (in place, untested)
- Investigate weirdness on Chrome for Android (might be resolved)
- Comments by students (maybe per class) - very low priority

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
- [ ] Evaluate Mux Video (pricing, data residency, GDPR)
- [ ] Research Infomaniak kDrive/kVideo (Swiss-hosted)
- [ ] Research alternatives: Swisscom, Cloudflare Stream (EU), bunny.net
- [ ] Decision criteria: Swiss/EU data, GDPR compliant, adaptive streaming, API, reasonable pricing

**Phase 1.1.2: Video Upload Implementation**
- [ ] Design video storage model (`Video` table, link to skripts)
- [ ] Implement upload flow (direct to provider, progress tracking)
- [ ] Build video uploader component (drag-drop, preview, management)
- [ ] Add video embedding to markdown (custom remark plugin, responsive player)

### 1.2 Interactive Quiz Component
**Goal**: In-lesson quizzes with student progress tracking

**Phase 1.2.1: Quiz Structure Design**
- [ ] Define quiz types (multiple choice, true/false, fill-in-blank, short answer, code challenges)
- [ ] Design quiz storage format (JSON schema in markdown)
- [ ] Plan integration with user data service (anonymous submissions, retry attempts)

**Phase 1.2.2: Quiz Component Implementation**
- [ ] Build quiz renderer (`src/components/quiz/quiz-renderer.tsx`)
- [ ] Build quiz editor (`src/components/dashboard/quiz-editor.tsx`)
- [ ] Integrate with markdown pipeline (` ```quiz` blocks)
- [ ] Connect to user data service

### 1.3 Custom Component Plugin System
**Goal**: Extensible plugin architecture for interactive lesson components

**Phase 1.3.1: Architecture Planning**
- [ ] Brainstorm approaches (sandboxed iframe vs React registration)
- [ ] Design plugin lifecycle (discovery, registration, rendering, hot reload)
- [ ] Consider marketplace implications (versioning, review, licensing)

**Phase 1.3.2: Core Plugin Infrastructure**
- [ ] Implement plugin loader system (`src/lib/plugins/registry.ts`)
- [ ] Build plugin sandbox environment
- [ ] Create plugin development kit (PDK)
- [ ] Update markdown pipeline for component blocks
- [ ] Build plugin management UI

---

## 🔲 Phase 2: Student Analytics & Progress Tracking

**Goal**: Enable teachers to track student progress while maintaining strict data privacy

### 2.1 Gradebook & Progress UI
- [ ] UI for consent flow (first-time student login)
- [ ] Gradebook interface (view progress, grade submissions)
- [ ] Student progress tracking API endpoints
- [ ] Submission management UI

### 2.2 Progress Tracking System
- [ ] Implement progress tracking API (`/api/progress/track`)
- [ ] Build progress dashboard for teachers (class overview, individual progress, analytics)
- [ ] Student progress view (`/my-progress`)

### 2.3 Zero-Knowledge Implementation (Optional Enhancement)
- [ ] Client-side encryption for progress data
- [ ] Teacher-side decryption for dashboard
- [ ] Document trade-offs (key loss = data loss, no aggregation without key)

---

## 🔲 Phase 3: Marketplace Foundation

### Extended Permission Model
```
Current: author | viewer
Future:  author | viewer | customer
```

**Features to implement:**
- [ ] Mark skripts/collections as "for sale" with pricing
- [ ] Viewers/customers can create editable copies
- [ ] Update notifications when original content changes
- [ ] Diff-editor for comparing and merging updates
- [ ] Payment provider integration
- [ ] License agreement for content rights

---

## 🔒 Security Model: No-Access-By-Default

**Key Principle**: Being a "collaborator" only establishes a relationship - it does NOT grant content access.

**Permission Structure:**
- Junction tables: `CollectionAuthor`, `SkriptAuthor`, `PageAuthor`
- `permission = "author"` = edit rights
- `permission = "viewer"` = view rights

**Drag-and-Drop Permission Model:**
- "Ownership Transfer" approach (like Google Drive/Dropbox)
- Moving requires edit permissions on BOTH source AND target
- Automatic permission granting on move
- View-only content cannot be dragged

**Access Flow:**
1. Teachers become "collaborators" (partnership established)
2. Content owners explicitly share specific collections/skripts
3. Collaborators only see content they've been given access to
4. Automatic permission granting ensures proper ownership on move
5. Default permission for new content: `none`

**Benefits:**
- ✅ Privacy by default
- ✅ Granular control over content sharing
- ✅ Secure content movement with automatic permission management
- ✅ Clear audit trail of what's been shared and moved
- ✅ Scalable for marketplace (customers only see purchased content)
