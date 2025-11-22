# Completed Features

This file tracks features that have been fully implemented and deployed.

*Last updated: 2025-11-22*

---

## 🔄 Subdomain Routing Removal (2025-11-22)

**Goal**: Simplify architecture by removing complex subdomain routing in favor of username-based path routing.

**Completed:**
- ✅ **Database Migration** - Renamed `User.subdomain` → `User.username`
- ✅ **Removed Custom Domain Model** - Dropped `CustomDomain` table and all related functionality
- ✅ **Simplified Proxy** - Removed all subdomain detection and rewriting logic
- ✅ **Path-Based Routing** - All public pages now use `eduskript.org/username/...` structure
- ✅ **Updated 56+ Files** - Complete migration across database, API, UI, tests, and documentation
- ✅ **All Tests Passing** - 256 tests validated after migration
- ✅ **Production Build** - Fixed Suspense boundaries for Next.js 16 static generation
- ✅ **Enhanced Seed Data** - No longer creates dummy users, auto-refresh after seeding

**Files Removed:**
- `/src/app/api/domains/**` - Custom domain endpoints
- `/src/app/api/user/custom-domains/**` - User domain management
- `/src/app/dashboard/settings/domains/**` - Domain settings UI
- `/src/components/CustomDomainHandler.tsx` - Subdomain detection component
- `/src/components/dashboard/custom-domains.tsx` - Domain management UI
- `/src/components/dashboard/domain-settings.tsx` - Domain settings form

**Benefits:**
- Simpler architecture without complex subdomain handling
- Works reliably on all hosting platforms (especially Koyeb)
- Easier to understand and maintain
- Cleaner URL structure
- No DNS configuration needed for new users

---

## ✅ Privacy-Preserving Class Management (Phase 0.5)

**Completed: 2025-01-XX**

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

---

## ✅ Microsoft Authentication & GDPR Privacy Infrastructure (Phase 0)

**Completed: 2025-01-XX**

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

## ✅ Admin User System (Phase 0)

**Completed: 2025-01-08**

**Goal**: The first user to be created should be an administrator that can create, delete and alter existing users, including resetting their password.

**All tasks completed:**
- ✅ Added `isAdmin` and `requirePasswordReset` fields to User schema
- ✅ Created admin seed script (`prisma/seed-admin.js`) that runs on container startup
- ✅ Default admin user: eduadmin@eduskript.org / letseducate (password reset required on first login)
- ✅ Implemented forced password reset flow
  - Password reset page at `/auth/reset-password` with validation
  - API endpoint for password updates with session refresh
  - Dashboard redirect enforcement via middleware
- ✅ Admin-only APIs with proper authentication (`/lib/admin-auth.ts`):
  - User CRUD operations (create, read, update, delete)
  - Admin password reset for users
  - Example data seeder with math and physics content
- ✅ Admin panel UI at `/dashboard/admin`:
  - User management interface with search/filter
  - Create/edit/delete users with proper Radix UI dialogs
  - Reset user passwords with optional force-reset flag
  - Example data seeder accessible from empty page builder state
- ✅ Admin panel link in dashboard sidebar (visible to admins only, with Shield icon)
- ✅ Fixed NextAuth compatibility issue (PrismaAdapter conflicting with CredentialsProvider)
- ✅ Fixed Next.js 15+ async params in API routes (await params Promise)
- ✅ Created `pnpm dev:reset` script for quick database reset + admin seed
- ✅ Example data includes published collections, skripts, and pages with markdown content

**Key Files:**
- `/src/app/dashboard/admin/page.tsx` - Admin panel UI
- `/src/app/api/admin/**` - Admin API endpoints
- `/src/lib/admin-auth.ts` - Admin authentication helper
- `/src/app/auth/reset-password/page.tsx` - Password reset flow
- `/prisma/seed-admin.js` - Admin user seeding
- `/src/app/api/admin/seed-example-data/route.ts` - Example data seeder

---

## ✅ Excalidraw Integration (Phase 1.1)

**Completed: 2025-01-08**

**Goal**: Enable teachers to create and embed drawings as themed SVGs

**All tasks completed:**
- ✅ Research Excalidraw integration approaches
  - ✅ Evaluate `@excalidraw/excalidraw` React component
  - ✅ Test theming capabilities (light/dark mode support)
  - ✅ SVG export functionality
- ✅ Design storage strategy
  - ✅ Store Excalidraw JSON alongside SVG export with naming: `drawingname.excalidraw`, `drawingname.excalidraw.light.svg`, `drawingname.excalidraw.dark.svg`
  - ✅ Use existing file storage system with deduplication
  - ✅ Automatic overwrite support for editing
- ✅ Implement Excalidraw editor modal
  - ✅ Create new component: `src/components/dashboard/excalidraw-editor.tsx`
  - ✅ Add toolbar button to markdown editor (Pencil icon)
  - ✅ Handle drawing creation/editing workflow
- ✅ Implement SVG embedding in markdown
  - ✅ Create custom remark plugin for `![[drawingname.excalidraw]]` syntax (`src/lib/remark-plugins/excalidraw-resolver.ts`)
  - ✅ Support automatic theme switching (light/dark SVG variants)
  - ✅ Integrated into markdown processing pipeline
- ✅ Add drawing management UI
  - ✅ List drawings in skript file browser with special icon
  - ✅ Hide auto-generated SVG files from file list
  - ✅ Edit button for existing drawings (orange Pencil icon)
  - ✅ Delete/rename functionality through standard file operations
- ✅ **Privacy consideration**: Drawings stored on server, no client-side data
- ✅ API endpoint: `/api/excalidraw` for saving/loading drawings

**Key Files:**
- `/src/components/dashboard/excalidraw-editor.tsx` - Excalidraw editor component
- `/src/lib/remark-plugins/excalidraw-resolver.ts` - Markdown integration plugin
- `/src/app/api/excalidraw/route.ts` - API endpoint for saving/loading drawings

---

## ✅ Access Management Dashboard (Phase 3 - Partial)

**Completed: 2025-01-08**

**Tasks completed:**
- ✅ **Collection-level permission overview** showing who has access to what
- ✅ **Clean up the old permission matrix** we no longer use it and went for a simpler UI
- ✅ **Individual skript permission settings** use the same interface as collections
- ✅ **Edge case fix**: when removing access to a skript or collection, the removed user will still see them in their page builder but without title. We now display a placeholder that says "Your access was revoked. This content can no longer be displayed on your page." and no longer display that script or collection on the user's page.

**Key Files:**
- `/src/components/permissions/*` - Permission management UI components
- `/src/lib/permissions.ts` - Permission checking logic

---

## ✅ Python Code Editor with Turtle Graphics (Phase 1.1)

**Completed: 2025-01-12**

**Goal**: Interactive Python code editor for students to learn programming with turtle graphics

**All tasks completed:**

**Phase 1.1.1: Setup Skulpt and Core Infrastructure** ✅
- ✅ Copied Skulpt files to public directory (`skulpt.min.js`, `skulpt-stdlib.js`)
- ✅ Created basic component structure at `src/components/public/code-editor/`
- ✅ Set up TypeScript types for Skulpt and editor config

**Phase 1.1.2: CodeMirror Integration** ✅
- ✅ Implemented CodeMirror 6 with Python language support
- ✅ Configured theme switching (light/dark mode with VSCode themes)
- ✅ Added line numbers and basic editing features
- ✅ Configured Python syntax highlighting
- ✅ Added editor controls (Run, Stop, Reset, Clear output)

**Phase 1.1.3: Skulpt Python Execution** ✅
- ✅ Configured Skulpt runtime with output capture
- ✅ Set up turtle graphics canvas with pan/zoom
- ✅ Error handling and display
- ✅ Execution limits for safety
- ✅ Canvas features: hideable, fullscreen mode, pan and zoom with mouse

**Phase 1.1.4: Terminal Output** ✅
- ✅ Terminal output area for print() statements
- ✅ Error messages with proper formatting
- ✅ Color-coded output types (stdout, stderr, warnings)
- ✅ Scrollable output with clear button

**Phase 1.1.5: Multi-File Support** ✅
- ✅ File tabs UI for multiple Python files
- ✅ Add/remove/rename file functionality (double-click to rename)
- ✅ Switch between files in editor
- ✅ Python import system with Skulpt custom modules
- ✅ Cross-file imports (with/without .py extension)

**Phase 1.1.6: Markdown Integration** ✅
- ✅ Custom remark plugin for code editor blocks (` ```python editor` syntax)
- ✅ Support initial code in markdown
- ✅ Render editor in public pages via hydration
- ✅ Editor toolbar button for inserting code blocks

**Phase 1.1.7: Advanced Features** ✅
- ✅ Client-side Python autocomplete:
  - Keyword and builtin function completion
  - Turtle graphics method completion
  - Module member completion (math, random, turtle)
  - Auto-trigger on dot notation
  - User-defined function/class/variable extraction and completion

**Phase 1.1.8: Unified VSCode Theme** ✅
- ✅ Replaced Shiki with CodeMirror for static code blocks
- ✅ All editors now use identical VSCode Light/Dark themes
- ✅ Support for code annotations: `[!code ++]`, `[!code --]`, `[!code highlight]`, `[!code focus]`
- ✅ Consistent syntax highlighting across interactive and static code

**Implementation Architecture:**
- **Editor**: CodeMirror 6 with Python language support
- **Python Runtime**: Skulpt.js (browser-based Python interpreter)
- **UI Layout**: Left = code editor with file tabs, Right = turtle canvas (pan/zoom, hideable), Bottom = terminal output
- **Multi-file**: Tab-based interface with add/remove/rename
- **Autocomplete**: Client-side language server with keyword, builtin, module, and user-defined symbol completion
- **Storage**: Component state (no persistence - resets on page reload)

**Key Files:**
- `/src/components/public/code-editor/index.tsx` - Main editor component
- `/src/components/public/code-editor/types.ts` - TypeScript definitions
- `/src/components/public/code-editor/python-completions.ts` - Client-side language intelligence
- `/src/lib/remark-plugins/code-editor.ts` - Markdown integration plugin
- `/src/components/markdown/codemirror-code-block.tsx` - Static code block renderer
- `/src/lib/rehype-plugins/codemirror-highlight.ts` - Syntax highlighting plugin
- `/src/components/dashboard/codemirror-editor.tsx` - Toolbar integration (~line 542)
- `/public/js/skulpt.min.js`, `/public/js/skulpt-stdlib.js` - Python runtime

**Future Enhancements:**
- Context-aware cross-file completion
- Auto-save to localStorage
- Code history/undo for sessions
- Share code snippets
- Keyboard shortcuts (Ctrl+Enter to run)

---

## ✅ Infrastructure & Build System (2025-01-15)

**Completed: 2025-01-15**

**Goal**: Migrate to Next.js 16 and fix critical infrastructure issues

**All tasks completed:**

**Next.js 16 Migration** ✅
- ✅ Migrated from `next lint` to `eslint .` (Next.js 16 removed built-in lint)
- ✅ Converted ESLint config to flat config format (eslint.config.mjs)
- ✅ Fixed pnpm version mismatch in GitHub Actions workflow
- ✅ Updated TypeScript config to exclude test directories from builds
- ✅ Resolved all 19 ESLint errors (React hooks, variable declarations)
- ✅ Build passes successfully with zero errors

**Subdomain Routing** ✅
- ✅ Fixed preview button URL generation in page builder
- ✅ Added native subdomain detection for `.eduskript.org` and `.localhost`
- ✅ Automatic path rewriting for subdomain URLs
- ✅ Users can access pages via `username.eduskript.org`

**UI Cleanup** ✅
- ✅ Removed duplicate VersionFooter component
- ✅ Kept GitInfo component in bottom right

**Key Files:**
- `.github/workflows/ci.yml` - Removed hardcoded pnpm version
- `package.json` - Updated lint script
- `eslint.config.mjs` - Flat config format
- `tsconfig.json` - Excluded test/review directories
- `src/components/CustomDomainHandler.tsx` - Subdomain detection
- `src/components/dashboard/page-builder-interface.tsx` - Preview URL logic
