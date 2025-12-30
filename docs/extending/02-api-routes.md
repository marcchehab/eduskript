# API Routes

Add new endpoints to the backend.

## Route Structure

```
src/app/api/
├── auth/[...nextauth]/route.ts   # Auth (don't touch)
├── collections/
│   ├── route.ts                  # GET, POST /api/collections
│   └── [id]/route.ts             # GET, PUT, DELETE /api/collections/:id
├── skripts/
│   └── route.ts
├── pages/
│   └── route.ts
└── your-feature/
    └── route.ts                  # Your new endpoint
```

## Basic Route

```typescript
// src/app/api/stats/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = await prisma.page.count({
    where: {
      authors: { some: { userId: session.user.id } }
    }
  })

  return NextResponse.json({ pageCount: stats })
}
```

## With Parameters

```typescript
// src/app/api/pages/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const page = await prisma.page.findUnique({
    where: { id }
  })

  if (!page) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(page)
}
```

## With Request Body

```typescript
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title, content } = body

  if (!title) {
    return NextResponse.json({ error: 'Title required' }, { status: 400 })
  }

  const page = await prisma.page.create({
    data: {
      title,
      content,
      slug: slugify(title),
      // ... other fields
    }
  })

  return NextResponse.json(page, { status: 201 })
}
```

## Permission Checks

Use the permission helpers:

```typescript
import { canEditSkript } from '@/lib/permissions'

export async function PUT(request: NextRequest, { params }) {
  const { id } = await params
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const skript = await prisma.skript.findUnique({ where: { id } })

  if (!await canEditSkript(session.user.id, skript)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Proceed with update...
}
```

## Testing Routes

```typescript
// tests/api/stats.test.ts
import { GET } from '@/app/api/stats/route'
import { createMockSession } from '@tests/helpers/api-helpers'

vi.mock('@/lib/prisma')

it('returns page count for authenticated user', async () => {
  createMockSession({ userId: 'user-1' })
  prisma.page.count.mockResolvedValue(5)

  const response = await GET()
  const data = await response.json()

  expect(response.status).toBe(200)
  expect(data.pageCount).toBe(5)
})

it('returns 401 for unauthenticated', async () => {
  createMockSession(null)

  const response = await GET()

  expect(response.status).toBe(401)
})
```

## Patterns

| Pattern | Use |
|---------|-----|
| Return early on auth failure | Keep logic flat |
| Validate input before database calls | Fail fast |
| Use permission helpers | Don't reinvent |
| Return appropriate status codes | 200, 201, 400, 401, 403, 404 |
