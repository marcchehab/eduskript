# Data Models

The database schema lives in `prisma/schema.prisma`.

## Core Hierarchy

```
User
 └── Collection (course)
      └── CollectionSkript (junction, with order)
           └── Skript (module)
                └── Page (lesson)
                     └── File (attachment)
```

## User

```prisma
model User {
  id            String    @id @default(cuid())
  email         String?   @unique
  name          String?
  pageSlug      String?   @unique   // URL: eduskript.org/[pageSlug]
  pageName      String?             // Display name for public page
  isAdmin       Boolean   @default(false)
  accountType   String    @default("teacher")  // "teacher" | "student"
}
```

**Page vs Profile fields:**
- `pageSlug`, `pageName`, `pageDescription` → public page
- `name`, `bio`, `title` → user profile

## Content Models

```prisma
model Collection {
  id          String  @id @default(cuid())
  title       String
  slug        String
  description String?
  isPublished Boolean @default(false)
}

model Skript {
  id          String  @id @default(cuid())
  title       String
  slug        String
  description String?
  isPublished Boolean @default(false)
}

model Page {
  id          String  @id @default(cuid())
  title       String
  slug        String
  content     String  @db.Text
  order       Int     @default(0)
  isPublished Boolean @default(false)
  skriptId    String
}
```

## Junction Tables

Collections and Skripts have a many-to-many relationship:

```prisma
model CollectionSkript {
  collectionId String
  skriptId     String
  order        Int @default(0)

  @@id([collectionId, skriptId])
}
```

A skript can belong to multiple collections.

## Permission Tables

Each content type has an author table:

```prisma
model CollectionAuthor {
  collectionId String
  userId       String
  permission   String  // "author" | "viewer"

  @@id([collectionId, userId])
}

model SkriptAuthor { ... }
model PageAuthor { ... }
```

## File Storage

```prisma
model File {
  id          String  @id @default(cuid())
  name        String
  hash        String?           // SHA256 for deduplication
  contentType String?
  size        BigInt?
  skriptId    String
  parentId    String?           // For nested directories
  createdBy   String

  @@unique([parentId, name, skriptId])
}
```

## User Data (Student Work)

```prisma
model UserData {
  id       String @id @default(cuid())
  userId   String
  adapter  String  // 'code', 'annotations', 'settings', 'snaps'
  itemId   String  // pageId or 'global'
  data     Json    // Flexible payload
}
```

## Organizations

Multi-tenant support with role-based membership:

```prisma
model Organization {
  id          String  @id @default(cuid())
  name        String
  slug        String  @unique  // /org/[slug]
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

**Roles:**
- `owner` - Billing, delete org, transfer ownership
- `admin` - Manage members, invite, reset passwords
- `member` - Basic access, listed as member

All users belong to Eduskript org by default. Platform admins (`isAdmin=true`) transcend org boundaries.

## Classes

Teacher-owned groups for student management:

```prisma
model Class {
  id             String  @id @default(cuid())
  name           String
  teacherId      String
  inviteCode     String  @unique
  allowAnonymous Boolean @default(false)
}

model ClassMembership {
  classId        String
  userId         String
  identityConsent Boolean @default(false)

  @@unique([classId, userId])
}
```

## Common Queries

**Get user's collections:**
```typescript
await prisma.collection.findMany({
  where: {
    authors: { some: { userId, permission: 'author' } }
  }
})
```

**Get skripts in a collection:**
```typescript
await prisma.skript.findMany({
  where: {
    collectionSkripts: { some: { collectionId } }
  },
  orderBy: {
    collectionSkripts: { _count: 'asc' }  // by order
  }
})
```

**Get pages in a skript:**
```typescript
await prisma.page.findMany({
  where: { skriptId },
  orderBy: { order: 'asc' }
})
```
