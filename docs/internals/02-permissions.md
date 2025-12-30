# Permissions

Eduskript uses **no-access-by-default**. Content must be explicitly shared.

## Permission Levels

| Level | Meaning |
|-------|---------|
| `author` | Can edit, delete, manage permissions |
| `viewer` | Read-only access |

## How It Works

Permissions are stored in junction tables:

```
CollectionAuthor: { collectionId, userId, permission }
SkriptAuthor:     { skriptId, userId, permission }
PageAuthor:       { pageId, userId, permission }
```

No entry = no access.

## Checking Permissions

```typescript
// src/lib/permissions.ts

export async function canEditCollection(userId: string, collectionId: string) {
  const author = await prisma.collectionAuthor.findUnique({
    where: {
      collectionId_userId: { collectionId, userId }
    }
  })
  return author?.permission === 'author'
}

export async function canViewCollection(userId: string, collectionId: string) {
  const author = await prisma.collectionAuthor.findUnique({
    where: {
      collectionId_userId: { collectionId, userId }
    }
  })
  return author?.permission === 'author' || author?.permission === 'viewer'
}
```

## Inheritance Rules

1. **Collection author** → can view all skripts in that collection
2. **Skript author** → can edit all pages in that skript
3. **Page permission** → overrides skript permission

```typescript
export async function canEditPage(userId: string, page: Page) {
  // Check page-level permission first
  const pageAuthor = await prisma.pageAuthor.findUnique({
    where: { pageId_userId: { pageId: page.id, userId } }
  })
  if (pageAuthor?.permission === 'author') return true

  // Fall back to skript-level permission
  const skriptAuthor = await prisma.skriptAuthor.findUnique({
    where: { skriptId_userId: { skriptId: page.skriptId, userId } }
  })
  return skriptAuthor?.permission === 'author'
}
```

## Granting Permissions

```typescript
await prisma.collectionAuthor.create({
  data: {
    collectionId,
    userId: collaboratorId,
    permission: 'author'  // or 'viewer'
  }
})
```

## Removing Permissions

```typescript
await prisma.collectionAuthor.delete({
  where: {
    collectionId_userId: { collectionId, userId }
  }
})
```

## In API Routes

Always check permissions after authentication:

```typescript
export async function PUT(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  if (!await canEditSkript(session.user.id, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Proceed...
}
```

## Public Access

Published content is publicly viewable without authentication:

```typescript
// Check if content is accessible
const page = await prisma.page.findUnique({
  where: { id },
  include: { skript: { include: { collectionSkripts: { include: { collection: true } } } } }
})

const isPublic = page?.isPublished &&
  page?.skript?.isPublished &&
  page?.skript?.collectionSkripts?.some(cs => cs.collection.isPublished)
```

## Admin Override

Admins (`isAdmin: true`) can access everything:

```typescript
if (session.user.isAdmin) {
  // Skip permission checks
}
```
