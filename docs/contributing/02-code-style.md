# Code Style

Patterns and conventions used in the codebase.

## TypeScript

- Strict mode enabled
- ES2023 target
- Prefer `interface` over `type` for objects
- Use explicit return types on exported functions

```typescript
// Good
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}

// Avoid
export const calculateTotal = (items) => {
  return items.reduce((sum, item) => sum + item.price, 0)
}
```

## React Components

```typescript
// Function components with explicit props
interface ButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
```

## API Routes

```typescript
// Pattern: early returns, flat structure
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  if (!body.title) {
    return NextResponse.json({ error: 'Title required' }, { status: 400 })
  }

  const result = await prisma.page.create({ data: { ... } })
  return NextResponse.json(result, { status: 201 })
}
```

## Comments

Write comments that explain **why**, not what:

```typescript
// Good: explains the why
// Skip permission check for published content - anyone can view
if (page.isPublished) {
  return page
}

// Bad: just restates the code
// Check if page is published
if (page.isPublished) {
  return page
}
```

Document known limitations:

```typescript
// WORKAROUND: React Query doesn't invalidate automatically here.
// Manually trigger refetch after mutation.
queryClient.invalidateQueries(['pages'])

// Note: O(n²) for small lists. Consider Set for >100 items.
const unique = items.filter((item, i) => items.indexOf(item) === i)
```

## File Organization

```
// One component per file
// Name file same as component
Button.tsx → export function Button()

// Colocate tests
Button.tsx
Button.test.tsx

// Group by feature, not type
components/
  dashboard/
    PageEditor.tsx
    PageEditor.test.tsx
  public/
    MarkdownRenderer.tsx
```

## Imports

```typescript
// External packages first
import { useState, useEffect } from 'react'
import { NextResponse } from 'next/server'

// Then internal imports with @/ alias
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'

// Then relative imports
import { helperFunction } from './utils'
```

## Naming

| Thing | Convention | Example |
|-------|------------|---------|
| Components | PascalCase | `PageEditor` |
| Functions | camelCase | `calculateTotal` |
| Constants | SCREAMING_SNAKE | `MAX_FILE_SIZE` |
| Files | kebab-case | `page-editor.tsx` |
| Database fields | camelCase | `isPublished` |
| URL slugs | kebab-case | `my-collection` |

## Don't

- Don't add features beyond what's asked
- Don't refactor unrelated code
- Don't add comments to unchanged code
- Don't create abstractions for one-time use
