# Authentication

NextAuth.js with context-aware sign-in flows.

## Account Types

| Type | Sign-in methods | Created when |
|------|-----------------|--------------|
| **Teacher** | OAuth or credentials | Sign up on main site |
| **Student** | OAuth only | Sign in on teacher's page |

Students don't have passwords. They're identified by a pseudonymized hash, not email.

## Context Detection

Location determines the sign-in experience:

| Context | URL | Default for new OAuth |
|---------|-----|----------------------|
| Main site | `/auth/signin` | Teacher account |
| Teacher's page | `/auth/signin?from=[pageSlug]` | Student account |

The `from` param is preserved through OAuth via a cookie (`oauth_from_teacher_page`).

## Sign-In Flow

```
User clicks "Sign in"
    ↓
/auth/signin?from=teacherslug  (or no param for main site)
    ↓
Set cookie if from teacher page
    ↓
OAuth redirect → Provider → Return
    ↓
auth.ts checks cookie:
  - Has cookie → create student account
  - No cookie → create teacher account
    ↓
Clear cookie
```

## Key Rules

- Existing accounts take precedence (teacher stays teacher regardless of context)
- Credentials = always teacher (students don't have passwords)
- New OAuth on main site → teacher
- New OAuth on teacher page → student (pseudonymized)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | NextAuth config, account type detection |
| `src/lib/privacy-adapter.ts` | Creates student accounts with pseudonyms |
| `src/components/auth/signin-form.tsx` | Context-aware sign-in UI |
| `src/app/auth/signin/page.tsx` | Sign-in page router |

## Session Data

```typescript
// Available in session.user
interface SessionUser {
  id: string
  email?: string        // Null for students
  name?: string
  isAdmin: boolean
  accountType: 'teacher' | 'student'
  pageSlug?: string     // Teacher's public page URL
}
```

## Checking Auth in API Routes

```typescript
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // session.user.id, session.user.accountType, etc.
}
```
