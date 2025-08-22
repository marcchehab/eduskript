# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

We use pnpm.

### Database Operations
- `pnpm db:generate` - Generate Prisma client after schema changes
- `pnpm db:push` - Push schema changes to database (for development)
- `pnpm db:migrate` - Deploy migrations (for production)
- `pnpm db:studio` - Open Prisma Studio for database inspection
- `pnpm db:reset` - Reset database and run migrations
- `pnpm db:fresh` - Fresh start: removes SQLite files and pushes schema

### Development & Build
- `pnpm dev` - Start development server with Turbopack
- `pnpm build` - Build for production (includes Prisma generation)
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

### Docker Operations
- `pnpm docker:build` - Build Docker image with git metadata
- `pnpm docker:run` - Run application in Docker (dev compose)
- `pnpm docker:stop` - Stop Docker containers
- `pnpm docker:logs` - View Docker container logs

## Architecture Overview

### Application Structure
Eduskript is a multi-tenant education platform where teachers create educational content using markdown. The hierarchy is: **User → Collections → Skripts → Pages**.

**Core Concepts:**
- **Collections**: Bundles of skripts (formerly called "scripts", renamed to "skripts")
- **Skripts**: Individual educational modules containing multiple pages
- **Pages**: Individual content pieces with markdown, LaTeX math, and syntax highlighting
- **Collaboration**: Teachers can partner and share content with granular permissions

### Technology Stack
- **Framework**: Next.js 15 with App Router and TypeScript
- **Database**: SQLite with Prisma ORM (6.11.0)
- **Authentication**: NextAuth.js with JWT strategy, supporting credentials + OAuth (GitHub/Google)
- **Styling**: TailwindCSS with Radix UI components
- **Editor**: CodeMirror 6 with multiple language support
- **Markdown**: Unified/Remark/Rehype pipeline with KaTeX math and syntax highlighting

### Database Schema Key Points
- **Multi-tenant**: Each user has a subdomain (e.g., `teacher.eduskript.org`)
- **Permission System**: Many-to-many relations between users and content (CollectionAuthor, SkriptAuthor, PageAuthor)
- **Permissions**: `author` (can edit/manage) and `viewer` (read-only access)
- **Versioning**: Page content versioning with rollback capabilities
- **File Storage**: Hierarchical file system for each skript with deduplication via hash
- **Collaboration**: Request-based partnership system between teachers

### Routing Architecture
- **Multi-tenant routing**: Middleware handles subdomain detection and URL rewriting
- **Dynamic routes**: `[domain]/[collectionSlug]/[skriptSlug]/[pageSlug]` for public content
- **Dashboard**: Protected routes under `/dashboard` for content management
- **API**: RESTful endpoints under `/api` with authentication middleware

### Permission Model
**No-access-by-default**: Being a collaborator doesn't grant content access automatically. Content must be explicitly shared.

**Inheritance Hierarchy:**
1. Collection authors can view all skripts in their collections
2. Skript authors can edit all pages in their skripts  
3. Page-level permissions override skript-level permissions

**Current Implementation:**
- Collections, Skripts, and Pages each have their own author tables
- Authors can add/remove other authors (but can't remove themselves if they're the last author)
- Permissions are checked in `src/lib/permissions.ts`

### Key Files & Directories

**Project planning:**
- `CLAUDE_ROADMAP.md` - The current planning and roadmap, keep this up to date!

**Configuration:**
- `prisma/schema.prisma` - Database schema definition
- `src/middleware.ts` - Handles subdomain routing and auth protection
- `src/lib/auth.ts` - NextAuth configuration with multiple providers
- `src/lib/permissions.ts` - Permission checking logic
- `src/lib/prisma.ts` - Prisma client setup
- `tailwind.config.ts` - TailwindCSS configuration with custom theme
- `next.config.ts` - Next.js configuration

**Entry Points:**
- `src/app/layout.tsx` - Root layout with providers
- `src/app/page.tsx` - Homepage
- `src/app/dashboard/layout.tsx` - Dashboard layout
- `src/app/dashboard/page.tsx` - Dashboard homepage
- `src/app/[domain]/page.tsx` - Public user pages (subdomain routing)

**Core Components:**
- `src/components/dashboard/` - Dashboard UI components (editors, modals, settings)
- `src/components/public/` - Public-facing components (markdown renderer, TOC)
- `src/components/permissions/` - Permission management UI components
- `src/components/ui/` - Reusable UI components (buttons, dialogs, etc.)

**API Routes:**
- `src/app/api/auth/[...nextauth]/route.ts` - NextAuth authentication
- `src/app/api/collections/route.ts` - Collections CRUD
- `src/app/api/skripts/route.ts` - Skripts CRUD  
- `src/app/api/pages/route.ts` - Pages CRUD
- `src/app/api/upload/route.ts` - File upload handling
- `src/app/api/collaboration-requests/route.ts` - Teacher collaboration system

**Types & Utils:**
- `src/types/index.ts` - TypeScript type definitions
- `src/types/next-auth.d.ts` - NextAuth type extensions
- `src/lib/utils.ts` - Utility functions

### Editor Features
- **Multiple Editors**: CodeMirror-based with language-specific highlighting
- **Markdown Pipeline**: Supports GFM, math (KaTeX), and custom remark plugins
- **File Handling**: Upload and reference files within skript content
- **Version Control**: Automatic page versioning with restore capability

### Deployment Configuration
- **Docker**: Includes multi-stage build with git metadata injection
- **Next.js**: Configured for standalone output
- **Database**: SQLite for development, migrations handled by Prisma
- **Environment**: Node.js 22.x, uses pnpm package manager

## Testing
- No specific test framework is currently configured
- Test database operations using `pnpm db:studio` for inspection

## Current Development Focus
Working on enhanced permission management UI and collaboration features. See `PERMISSIONS_ROADMAP.md` for planned improvements to content sharing and access management.