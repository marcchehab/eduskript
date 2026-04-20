# Data Models

The database schema lives in `prisma/schema.prisma`. This is a tour of the main models, not exhaustive — use `prisma studio` (`pnpm db:studio`) to browse everything live.

---

## Core content hierarchy

```
User
 └── Collection (course)
      └── CollectionSkript (junction, with order)
           └── Skript (module)
                └── Page (lesson)
                     └── File (attachment, scoped to Skript)
```

Collections and Skripts have many-to-many — a skript can belong to multiple collections.

---

## User

```prisma
model User {
  id            String    @id @default(cuid())
  email         String?   @unique
  name          String?              // Profile name
  bio           String?              // Profile bio
  title         String?              // Profile title (e.g. "Math teacher")
  pageSlug      String?   @unique    // URL: eduskript.org/[pageSlug]
  pageName      String?              // Display name for public page
  pageDescription String?            // Public page description
  isAdmin       Boolean   @default(false)
  accountType   String    @default("teacher")  // "teacher" | "student"
  studentPseudonym String?           // For student accounts
  oauthProvider    String?           // For student accounts (no email stored)
  oauthProviderId  String?
}
```

**Page vs Profile fields** (important distinction):

- `pageSlug`, `pageName`, `pageDescription` → everything about the user's **public page** (what students see)
- `name`, `bio`, `title` → everything about the **user's profile** (shown to collaborators)

Students use `oauthProvider` + `oauthProviderId` instead of email for privacy.

---

## Content models

```prisma
model Collection {
  id          String  @id @default(cuid())
  title       String
  slug        String
  description String?
}

model Skript {
  id              String  @id @default(cuid())
  title           String
  slug            String
  description     String?
  isPublished     Boolean @default(false)
  forkedFromId    String?           // Provenance chain for forks
}

model Page {
  id          String  @id @default(cuid())
  title       String
  slug        String
  content     String  @db.Text
  order       Int     @default(0)
  isPublished Boolean @default(false)
  isUnlisted  Boolean @default(false)
  pageType    String  @default("page")  // "page" | "exam" | "frontpage"
  skriptId    String
}
```

---

## Junction tables

```prisma
model CollectionSkript {
  collectionId String
  skriptId     String
  order        Int @default(0)

  @@id([collectionId, skriptId])
}
```

---

## Permission tables

One author table per content type:

```prisma
model CollectionAuthor {
  collectionId String
  userId       String
  permission   String  // "author" | "viewer"
  role         String  @default("author")  // "author" | "contributor"

  @@id([collectionId, userId])
}

model SkriptAuthor { ... same shape }
model PageAuthor   { ... same shape }
```

`permission` controls access level (edit vs read). `role` controls copyright ownership semantics (co-author vs contributor — see the Content License chapter in the user manual).

---

## File storage

```prisma
model File {
  id          String  @id @default(cuid())
  name        String
  hash        String?           // SHA256 for deduplication
  contentType String?
  size        BigInt?
  skriptId    String            // Parent skript (files are per-skript)
  parentId    String?           // For nested directories
  createdBy   String
  isDirectory Boolean @default(false)

  @@unique([parentId, name, skriptId])
}
```

Content-addressed by `hash`. See the **File Storage** chapter for the S3 storage layer.

---

## Video (Mux-hosted)

```prisma
model Video {
  id           String  @id @default(cuid())
  skriptId     String
  filename     String
  playbackId   String            // Mux playback ID
  metadata     Json              // { duration, posterUrl, aspectRatio, ... }
  status       String            // "processing" | "ready" | "errored"
}
```

Videos are separate from the `File` table — they use Mux for streaming, not S3.

---

## Plugins

```prisma
model Plugin {
  id               String  @id @default(cuid())
  slug             String
  ownerPageSlug    String            // For URL: /ownerSlug/pluginSlug
  name             String
  description      String?
  entryHtml        String  @db.Text
  manifest         Json              // { defaultHeight, configSchema, ... }
  forkedFromId     String?
  isPublic         Boolean @default(true)

  @@unique([ownerPageSlug, slug])
}
```

Plugin HTML is stored inline. See the **Plugins** chapter in `extending/` for how they're sandboxed and embedded.

---

## UserData (student work, multi-adapter)

```prisma
model UserData {
  id       String @id @default(cuid())
  userId   String
  adapter  String  // 'code' | 'annotations' | 'settings' | 'snaps' | 'preferences' | 'plugin'
  itemId   String  // pageId, or 'global' for per-user state
  data     Json    // Flexible payload per adapter
  updatedAt DateTime @updatedAt

  @@unique([userId, adapter, itemId])
}
```

One generic table for every kind of persisted user state. The `adapter` field routes to per-type schemas enforced in `src/lib/userdata/adapters.ts`.

---

## FrontPage (custom landing pages)

```prisma
model FrontPage {
  id          String  @id @default(cuid())
  userId      String?              // User's landing page
  collectionId String?             // Collection's landing page
  skriptId    String?              // Skript's landing page
  organizationId String?           // Organization's landing page
  content     String  @db.Text
}
```

A user, collection, skript, or organization can have at most one FrontPage — a custom markdown document used as the "front door" before students dive into pages.

Also `FrontPageVersion` for version history, same shape.

---

## PageLayout (public page organization)

```prisma
model PageLayout {
  id     String  @id @default(cuid())
  userId String  @unique
}

model PageLayoutItem {
  layoutId   String
  type       String           // "collection" | "skript" | "text"
  contentId  String?          // ID of the collection or skript
  order      Int
}
```

Structures what appears on a user's public landing page, and in what order.

---

## Organizations

```prisma
model Organization {
  id          String  @id @default(cuid())
  name        String
  slug        String  @unique      // /org/[slug]
  billingPlan String  @default("free")

  members     OrganizationMember[]
}

model OrganizationMember {
  organizationId String
  userId         String
  role           String  @default("member")  // "owner" | "admin" | "member"

  @@unique([organizationId, userId])
}
```

All users belong to the default Eduskript org. Platform admins (`isAdmin=true`) transcend org boundaries.

---

## Classes

```prisma
model Class {
  id             String  @id @default(cuid())
  name           String
  teacherId      String
  inviteCode     String  @unique
  allowAnonymous Boolean @default(false)
  archived       Boolean @default(false)
}

model ClassMembership {
  classId        String
  userId         String
  identityConsent Boolean @default(false)
  joinedAt       DateTime @default(now())

  @@unique([classId, userId])
}

model PreAuthorizedStudent {
  classId    String
  pseudonym  String
  claimedBy  String?           // User ID if matched
}
```

---

## Exams and submissions

```prisma
model ExamState {
  pageId   String
  classId  String
  state    String           // "closed" | "lobby" | "open"
  openedAt DateTime?
  closedAt DateTime?

  @@id([pageId, classId])
}

model StudentSubmission {
  id         String   @id @default(cuid())
  userId     String
  pageId     String
  classId    String?
  content    Json               // Snapshot of all editor state, quiz answers, etc.
  score      Float?             // Auto-graded score
  manualScore Float?            // Teacher-assigned override
  feedback   String?            // Teacher feedback
  submittedAt DateTime
}
```

Exam state is per-page-per-class. Submissions are per-student-per-page.

---

## Import/export jobs

```prisma
model ImportJob {
  id        String   @id @default(cuid())
  userId    String
  status    String              // "queued" | "running" | "complete" | "errored"
  progress  Int      @default(0)
  payload   Json
  result    Json?
}
```

For async operations like bulk imports, exports, AI Edit generation, seed operations. The UI polls `/api/import-jobs/:id` for progress.

---

## Common queries

**Get user's collections (as author):**
```typescript
await prisma.collection.findMany({
  where: { authors: { some: { userId, permission: 'author' } } }
})
```

**Get skripts in a collection, ordered:**
```typescript
await prisma.collectionSkript.findMany({
  where: { collectionId },
  orderBy: { order: 'asc' },
  include: { skript: true }
})
```

**Get pages in a skript, ordered:**
```typescript
await prisma.page.findMany({
  where: { skriptId },
  orderBy: { order: 'asc' }
})
```

**Get user's user-data for a page:**
```typescript
await prisma.userData.findUnique({
  where: {
    userId_adapter_itemId: {
      userId, adapter: 'code', itemId: pageId
    }
  }
})
```
