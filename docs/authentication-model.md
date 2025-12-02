# Authentication Model

## Overview

Location determines UI, existing accounts take precedence.

### Sign Up

| Context | Teachers | Students | UI |
|---------|----------|----------|-----|
| Main site | ✅ Full signup | ❌ Impossible | "Create a new teacher account" |
| Teacher's page | ❌ Page doesn't exist yet | ✅ Auto via sign-in | (no signup page) |

### Sign In

| Context | Teachers | Students | UI |
|---------|----------|----------|-----|
| Main site | ✅ | ❌ | "Sign into your teacher account" [OAuth] --- "Email & Password" |
| Teacher's page | ✅ | ✅ | "Sign in" [OAuth] --- collapsed "Sign in with email (teachers only)" |

### Key Rules

- Existing accounts take precedence (teacher with OAuth signing in from teacher page stays teacher)
- New OAuth on main site → teacher account
- New OAuth on teacher page → student account (pseudonymized)
- Credentials → always teacher (students don't have passwords)

## Context Detection

Context is passed via URL param:
- Main site links → `/auth/signin`
- Teacher page links → `/auth/signin?from=[pageSlug]`

The `from` param determines UI variant and default account type for new OAuth users.

A cookie (`oauth_from_teacher_page`) is set before OAuth redirect to persist context through the OAuth flow.

## Implementation Details

### Sign In Page (`/auth/signin`)

Single page with two UI variants based on `from` param:

**Main site (no `from` param):**
- Title: "Sign into your teacher account"
- OAuth buttons prominent
- Credentials form visible
- "Sign up" link visible

**Teacher page (has `from` param):**
- Title: "Sign in"
- OAuth buttons prominent
- Credentials form collapsed behind: "Sign in with email (teachers only) →"
- No "Sign up" link

### OAuth Flow

1. User clicks OAuth button
2. `SignInForm` sets `oauth_from_teacher_page` cookie if `from` param present
3. OAuth redirect to provider
4. User returns with OAuth token
5. `auth.ts` `isStudentSignup` reads cookie to determine account type
6. New user created as teacher (no cookie) or student (has cookie)
7. Cookie is cleared after sign-in

### Key Files

- `src/app/auth/signin/page.tsx` - Sign-in page router
- `src/components/auth/signin-form.tsx` - Sign-in form with collapsible credentials
- `src/lib/auth.ts` - NextAuth config with cookie-based account type detection
- `src/lib/privacy-adapter.ts` - Creates student accounts with pseudonyms
- `src/lib/auth-redirect.ts` - URL generation utilities
- `src/components/public/auth-button.tsx` - Sign-in button on teacher pages

## Implementation Status

### Code Changes (Completed)
- [x] Single `/auth/signin` page with `from` param context detection
- [x] Collapsible credentials form on teacher pages
- [x] Cookie-based OAuth account type detection (replaces global variable)
- [x] Removed redundant routes (`/signin/teacher`, `/signin/student`)
- [x] Removed `?type=teacher` from all links
- [x] Fixed signup page "subdomain" → "pageSlug"
- [x] Auth button on teacher pages includes `?from=[pageSlug]`

### Manual Testing Required
- [ ] Main site: Teacher signs in via OAuth → teacher account
- [ ] Main site: Teacher signs in via credentials → teacher account
- [ ] Main site: Teacher signs up → email verification → teacher account
- [ ] Teacher page: Student signs in via OAuth → student account (pseudonymized)
- [ ] Teacher page: Existing teacher signs in via OAuth → stays teacher
- [ ] Teacher page: Teacher signs in via credentials → teacher account
- [ ] Teacher page: No "Sign up" link visible
- [ ] Teacher page: "Sign in with email (teachers only)" is collapsed by default
- [ ] Main site: "Sign up" link visible
