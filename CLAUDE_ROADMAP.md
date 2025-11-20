**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

*Last updated: 2025-11-18*
*Current Status: Privacy-Preserving Class Management System - IMPLEMENTATION COMPLETE!*

> **Note**: Completed features have been moved to `COMPLETED_FEATURES.md`

---

add tests for docker deployment so it's as unlikely to fail on remote as possible.
make sure pushing to remote only works if tests pass.
Consider carefully if there is a way to identify students not only without storing emails, but without the emails even leaving the teacher's computer. (then again, is that necessary? oauth sends around emails all the time)
default student nicknames should be stoic philosophers or something like that.

## 📋 Current Implementation Status

### ✅ Phase 0: Microsoft Authentication & GDPR Privacy Infrastructure (COMPLETED)

**Microsoft OAuth Integration:**
- ✅ Added AzureADProvider to NextAuth configuration
- ✅ Transferred Azure AD credentials from informatikgarten.ch
- ✅ Updated environment configuration (.env, .env.example)
- ✅ Configured OAuth scopes: `openid profile email offline_access`
- ✅ Enabled PrismaAdapter for OAuth providers

**Privacy-Preserving Student Data Model:**
- ✅ Created pseudonym generation utilities (`src/lib/privacy/pseudonym.ts`)
  - HMAC-SHA256 hashing for stable, verifiable pseudonyms
  - Teacher verification without storing student PII
- ✅ Updated User schema with privacy fields:
  - `accountType` (teacher/student)
  - `studentPseudonym` (hashed identifier)
  - `gdprConsentAt` (consent timestamp)
  - `lastSeenAt` (for inactive account cleanup)
- ✅ Created StudentProgress model (page completion tracking)
- ✅ Created StudentSubmission model (assignments, grades, feedback)
- ✅ Updated auth callbacks to generate pseudonyms automatically
- ✅ Updated TypeScript types for session/JWT

**GDPR Compliance Endpoints:**
- ✅ Data export endpoint: `GET /api/user/data-export`
  - GDPR Article 15 - Right to Access
  - Exports all user data as downloadable JSON
- ✅ Account deletion endpoint: `DELETE /api/user/account`
  - GDPR Article 17 - Right to Erasure
  - Anonymizes student submissions (preserves teacher records)
  - Cascade deletes all other user data
- ✅ Account info endpoint: `GET /api/user/account`
  - Shows user stats and data counts

**Database & Testing:**
- ✅ Generated Prisma client with new schema
- ✅ Pushed schema changes to database
- ✅ Verified dev server starts successfully
- ✅ No TypeScript errors

### ✅ Phase 0.5: Privacy-Preserving Class Management (COMPLETED)

**Class Management System:**
- ✅ Created Class model with invite codes and teacher ownership
- ✅ Created ClassMembership junction table for many-to-many relationships
- ✅ Created PreAuthorizedStudent model for bulk import before signup
- ✅ Teacher-facing UI: `/dashboard/classes` for class list and creation
- ✅ Teacher-facing UI: `/dashboard/classes/[id]` for class details with:
  - Bulk email import (CSV/paste) that hashes emails to pseudonyms
  - Client-side localStorage mapping (email → pseudonym) for teacher verification
  - Student lookup tool to check enrollment status
  - Invite link generation and sharing
- ✅ Student-facing UI: `/classes/join/[inviteCode]` for joining classes
- ✅ Student-facing UI: `/dashboard/my-classes` for viewing enrolled classes
- ✅ Auto-enrollment via PrivacyAdapter during student signup
- ✅ API endpoints:
  - `GET/POST /api/classes` - List and create classes
  - `POST /api/classes/[id]/bulk-import` - Bulk import student emails
  - `GET /api/classes/[id]/students` - Get class roster
  - `GET/POST /api/classes/join/[inviteCode]` - Preview and join class
  - `GET /api/classes/my-classes` - Student's enrolled classes
- ✅ Cryptographically random 16-character invite codes (2^64 combinations)
- ✅ Server-side email hashing (HMAC-SHA256) - emails never stored in cleartext
- ✅ Client-side localStorage for email-to-pseudonym mapping
- ✅ Role-based sidebar navigation (Teachers see "Classes", Students see "My Classes")

**What's Next:**
- 🔲 UI for consent flow (first-time student login)
- 🔲 Gradebook interface (view progress, grade submissions)
- 🔲 Student progress tracking API endpoints
- 🔲 Submission management UI

---

## 🎯 Priority List (drag to reorder)

**LMS features:**
- **Student Accounts** - ✅ Core infrastructure complete, 🔲 UI implementation pending
- **Interactive Quizzes** - In-lesson quizzes with progress tracking

**Next up:**
- **Video Hosting** - Swiss-compliant video upload and embedding
- **Backup System** - Easy to use database exports and UI to restore database if necessary
- **Plugin System** - Extensible component architecture, MDX
- **Marketplace / Sharing** - Content sharing (unsure: selling?)


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
