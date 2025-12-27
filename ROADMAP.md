**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

**Note**: Completed features have been moved to `docs/COMPLETED_FEATURES.md`

### Annotation / Snap System Polish (Jan 2026)
*Core system complete, UX improvements needed:*
- [ ] i see multiple version of annotations on eduskript frontpage. it might be a locally cached version. i can't use the admin tool to delete site data however. 
- [ ] i see the snap i added to "public" twice when logged in as the author. once like a visitor and once like a snap i can edit. we only need to the latter, but add the green public icon as an indicator to the top right of the snap.
- [ ] Improve annotation UX - feels laggy on iPad, pressure curve may be off
- [ ] Scrolling improvements (momentum/inertia, center alignment when zoomed out)
- [ ] Delta updates for strokes (see `docs/`)?

## Add claude to backend?
- to use to create, edit, add, update pages inside a skript. (not multiple skripts at once, so context can be contained)

## Prepare open source publication of repo
- search for security vulnerabilities in git history
- setup issues and project infrastructure
- setup automation to make handling as simple as possible (do NOT overengineer!)

## 🐛 Known Bugs (Priority Order)
- **Major: Safari iPad snap freeze** - When using snap feature, freezes after border animation for ~30 seconds, then shows snap with wrong font and no annotations
- **Minor: Org frontpage cache invalidation** - Updated frontpage may still show old version (ISR cache issue)
- **Unconfirmed: Session state after logout** - (Partially fixed) Enabled `refetchOnWindowFocus` to prevent stale sessions between tabs

### Safe Exam Browser (SEB) Integration (Jan 2026)
*Most features complete, remaining work:*
- [ ] Switch to see what students are doing (like annotation system)
- [ ] After-exam teacher UX (correct/view exam, points overview)
- [ ] SEB security: upgrade from spoofable user agent to BEK validation

### Small Improvements
- Bigger handles for resize bars in editor on touch devices (in place, untested)
- Comments by students (maybe per class) - low priority


### LMS Features (Jan/Feb 2026)
- **Interactive Quizzes** - In-lesson quizzes with progress tracking (existing `<Question>` component has live answers)
- **Student Progress Tracking** - Gradebook interface, view progress, grade submissions
- **Randomized question/exercise pages** - Special skripts serving randomized pages per day/week
- **Exam pages** - Pages that are exams, unlockable for specific classes
- **Grading with points** - Annotation feedback system with points per question

### Infrastructure ()
- **Backup System** - Easy database exports and UI to restore
- **Marketplace / Sharing** - Content sharing and selling platform
- **Plugin System** - Extensible component architecture, MDX support
- **Full text search**

### Video Hosting Integration
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

