**IMPORTANT: Do not mark items as complete in this roadmap unless explicitly instructed by the user.**

**Note**: Completed features are to be documented in `docs/`
- User manual goes into writing-content, components, organization
- Dev docs go into getting-started, extending, internals, contributing, future-ideas. Only document major features, how we arrange smaller stuff document in code

## Needs testing

## Doing
actually create / edit content, sql, fix sil input dijkstra


## To do

*preview** buttons still often lead to wrong urls and thus produce 404s. e.g. in the page editor:
https://www.informatikgarten.ch/dashboard/collections/grundjahr/skripts/computer-os/pages/betriebssystem/edit
leads to: https://www.informatikgarten.ch/preview/ig/grundjahr/computer-os/betriebssystem (404, proper would be https://www.informatikgarten.ch/grundjahr/computer-os/betriebssystem
)

## Backlog

**metrics** don't work well at all - get rid of them?


## move back from mdx to markdown / remark
didn't realize the security vulnerability mdx poses. we have to move back.

stuff AI integration got wrong:
- 4 pages generated but only 3 made it into the skript? check production logs on koyeb using koyeb cli
- syntax for callouts wrong all the time, see example below
- syntax for tabs wrong, see xample below

WRONG

> [!tip] 
> **Analogie**
> Stellen Sie sich vor, Sie leuchten mit einer Taschenlampe durch ein Glas Wasser. Wenn Sie rote Tinte hineintropfen, wird das durchkommende Licht schwächer. Bei PPG ist das "rote Tinte" das pulsierende Blut in den Kapillaren.

:::tabs
::tab[Brustgurt (EKG-basiert)]
**Vorteile:**

::tab[Smartwatch (PPG-basiert)]
**Vorteile:**

- Abhängig von korrektem Sitz
:::

CORRECT

> [!tip] Analogie
> Stellen Sie sich vor, Sie leuchten mit einer Taschenlampe durch ein Glas Wasser. Wenn Sie rote Tinte hineintropfen, wird das durchkommende Licht schwächer. Bei PPG ist das "rote Tinte" das pulsierende Blut in den Kapillaren.

## documentation system
we want to write docs for eduskript that are mirrored into a collection on eduskript. since you have direct access to the codebase here, you can write a great documentary for open source contributors. later we can keep it up to date and sync it again. for this we need a parallelism between file structure and skripts. i say we use the exact same file structure we'd use in import too, which is (as far as i remember):

directory = skript name
- file = page inside skript
- attachments/ files used in skript files

now write two collections of clear, condensed docs. 
- one is a user manual for normal users
- one is a docs for developers who want to get involved

let's begin with the user manual: give me a numbered list of topics and i'll rank them by importance

give it here (i got it on the mainpage)
1. What is Eduskript (30-second pitch)

skript "Writing content":
"your first skript": 2. Creating your public page (medium) + 3. Content hierarchy: Collections → Skripts → Pages (very quick)
"writing your content" about markdown (basics)
"publish and share": 11. Publishing and visibility + 12. Sharing URLs with students
"Adding images and diagrams" and excalidraw
"adding other files to your skript"

skript "components":
overview (using all components even when not explained)
10. Callouts (notes, warnings, tips)
6. Math with LaTeX ($...$, $$...$$)
7. Code blocks with syntax highlighting
8. Interactive code editors (Python, JS, SQL)
9. SQL with database files

skript "organization":
14. Classes and student management
13. Collaborating with other teachers

  |------------------------------------|----------------|--------------------------------------------|
  | AUTHENTICATION_FLOWS.md            | Reference      | Integrate → internals/04-authentication.md |
  | LOGGING_SYSTEM.md                  | How-to         | Integrate → extending/04-debugging.md      |
  | REALTIME_EVENTS.md                 | Architecture   | Integrate → internals/05-realtime.md       |
  | CODE_EDITOR.md                     | Implementation | skip & delete       |
  | MDX_RENDER_PIPELINE.md             | Architecture   | skip & delete       |
  | STUDENT_DATA_STORAGE.md            | Architecture   | skip & delete               |
  | COMPLETED_FEATURES.md              | Changelog      | skip & delete     |
  | DELTA_SYNC.md                      | Future plan    | add to skript "future ideas"             |
  | ORGANIZATION_PLAN.md               | Plan           | add summary to dev docs, then delete                              |
  | TEACHER_BROADCAST_PLAN.md          | Plan           | add summary to dev docs, then delete |
  | ANNOTATION_SYSTEM.md               | Telemetry      | add summary to dev docs, then delete |
  | annotation-positioning-research.md | Research       | integrate with annotation system summary   |
  | REFETCH_ANALYSIS.md                | Analysis       | skip and delete   |

## Annotation / Snap System Polish (Jan 2026)
*Core system complete, UX improvements needed:*
- [ ] i see multiple version of annotations on eduskript frontpage. it might be a locally cached version. i can't use the admin tool to delete site data however. 
- [ ] i see the snap i added to "public" twice when logged in as the author. once like a visitor and once like a snap i can edit. we only need to the latter, but add the green public icon as an indicator to the top right of the snap.
- [ ] Improve annotation UX - feels laggy on iPad, pressure curve may be off
- [ ] Scrolling improvements (momentum/inertia, center alignment when zoomed out)
- [ ] Delta updates for strokes (see `docs/`)?

## Prepare open source publication of repo
- search for security vulnerabilities in git history
- setup issues and project infrastructure
- setup automation to make handling as simple as possible (do NOT overengineer!)

## 🐛 Known Bugs (Priority Order)
- **Major: Safari iPad snap freeze** - When using snap feature, freezes after border animation for ~30 seconds, then shows snap with wrong font and no annotations
- **Minor: Org frontpage cache invalidation** - Updated frontpage may still show old version (ISR cache issue)
- **Unconfirmed: Session state after logout** - (Partially fixed) Enabled `refetchOnWindowFocus` to prevent stale sessions between tabs

## Safe Exam Browser (SEB) Integration (Jan 2026)
*Most features complete, remaining work:*
- [ ] Switch to see what students are doing (like annotation system)
- [ ] After-exam teacher UX (correct/view exam, points overview)
- [ ] SEB security: upgrade from spoofable user agent to BEK validation

## Small Improvements
- Bigger handles for resize bars in editor on touch devices (in place, untested)
- Comments by students (maybe per class) - low priority

## LMS Features (Jan/Feb 2026)
- **Interactive Quizzes** - In-lesson quizzes with progress tracking (existing `<Question>` component has live answers)
- **Student Progress Tracking** - Gradebook interface, view progress, grade submissions
- **Randomized question/exercise pages** - Special skripts serving randomized pages per day/week
- **Exam pages** - Pages that are exams, unlockable for specific classes
- **Grading with points** - Annotation feedback system with points per question

## Infrastructure ()
- **Backup System** - Easy database exports and UI to restore
- **Marketplace / Sharing** - Content sharing and selling platform
- **Plugin System** - Extensible component architecture, MDX support
- **Full text search**

## Video Hosting Integration
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

## 1.2 Interactive Quiz Component
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

## 1.3 Custom Component Plugin System
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

