# Organization Groundwork Plan

## Status: TODO (Planning Phase)

This document describes the groundwork needed to support multi-tenant organizations in Eduskript.

---

## Problem Statement

Currently, Eduskript is user-centric:
- Individual teachers create accounts and own content
- Collaboration is peer-to-peer between teachers
- Admin capabilities are global (platform-level only)

**Need:** Schools and organizations want to:
- Pay per organization (not per teacher)
- Have organization admins who manage users within their org
- Control content at the organization level
- Have an organization-branded page

**Goal:** 
- Lay the groundwork
- turn eduskript itself into the first organization

---

## Design Principles

1. **Additive only** - New tables/fields, no changes to existing behavior
2. **Backward compatible** - Existing usquers/content work unchanged
3. **Opt-in** - Organization features don't affect non-org users
4. **Minimal** - Only add what's necessary for future extension

---

## Schema Design

### New Models

```prisma
model Organization {
  id          String   @id @default(cuid())
  name        String                          // "Gymnasium Kirchenfeld"
  slug        String   @unique                // "gymkirchenfeld" (for URLs)
  description String?
  logoUrl     String?
  website     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  members     OrganizationMember[]
  collections Collection[]
}

model OrganizationMember {
  id             String       @id @default(cuid())
  organizationId String
  userId         String
  role           String       @default("member")  // "admin" | "member"
  joinedAt       DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([organizationId])
  @@index([userId])
}
```

### Modified Models

```prisma
model User {
  // ... existing fields unchanged ...

  // NEW: Organization memberships (user can belong to multiple orgs)
  organizationMemberships OrganizationMember[]
}

model Collection {
  // ... existing fields unchanged ...

  // NEW: Optional org ownership (null = personal collection)
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
}
```

---

## Role Model

Simple two-tier system:

| Role | Capabilities |
|------|-------------|
| `admin` | Full control: manage members, manage org content, reset passwords, view analytics |
| `member` | Use org content, create content within org context |

**Note:** Global `isAdmin` (platform admin) remains separate. An org admin cannot manage other organizations or platform settings.

---

## Permission Interactions

### Current System (Unchanged)
```
User → CollectionAuthor → Collection
User → SkriptAuthor → Skript
User → PageAuthor → Page
```

### With Organizations (Future)
```
Organization → Collection (org owns collection)
                ↓
User → OrganizationMember → Organization (user is org member)
                ↓
User gets access to org's collections via membership
```

### Content Ownership Models

| Scenario | organizationId | Behavior |
|----------|---------------|----------|
| Personal content | `null` | Works exactly as today |
| Org content | `orgId` | Org members can access based on role |

### Cross-Organization Sharing (Future Feature)

For scenarios like "Teacher shares skript with Org A but not Org B":

```prisma
// FUTURE: Add when needed
model OrganizationSkriptPermission {
  id             String       @id @default(cuid())
  organizationId String
  skriptId       String
  permission     String       // "author" | "viewer"

  organization   Organization @relation(...)
  skript         Skript       @relation(...)

  @@unique([organizationId, skriptId])
}
```

This mirrors the existing `SkriptAuthor` pattern but for organizations instead of users. **Defer to later** - not part of groundwork.

---

## What This Groundwork Enables

Once the base models exist, we can build:

| Feature | How It Uses Groundwork |
|---------|----------------------|
| **Org Admin Panel** | Query `OrganizationMember` where `role = 'admin'` |
| **Org Content Browser** | Filter collections by `organizationId` |
| **User Management** | Admins CRUD `OrganizationMember` for their org |
| **Org Public Page** | Route `/org/[slug]` using `Organization.slug` |
| **Billing Integration** | Associate subscriptions with `Organization` |
| **Org Invites** | Add `OrganizationInvite` model later |
| **Org Settings** | Store in `Organization` or new settings table |

---

## Migration Safety

1. **`organizationId` on Collection is nullable** - Existing collections unaffected
2. **`OrganizationMember` is additive** - New junction table, no existing data changed
3. **No auth changes** - Authentication continues to work unchanged
4. **No API changes** - Existing endpoints unchanged
5. **No UI changes** - Dashboard works as before

---

## Implementation Steps

### Phase 1: Database Schema (Groundwork)

- [ ] Add `Organization` model to `prisma/schema.prisma`
- [ ] Add `OrganizationMember` model with role field
- [ ] Add optional `organizationId` to `Collection` model
- [ ] Add `organizationMemberships` relation to `User` model
- [ ] Run `pnpm db:generate` and `pnpm db:push` (or migrate)
- [ ] Add TypeScript types to `src/types/index.ts`

### Phase 2: Seed Eduskript Org (Optional)

```typescript
// Could seed the first org for dogfooding
const org = await prisma.organization.create({
  data: {
    name: 'Eduskript',
    slug: 'eduskript',
    description: 'Official Eduskript content',
  }
})

await prisma.organizationMember.create({
  data: {
    organizationId: org.id,
    userId: adminUserId,
    role: 'admin',
  }
})
```

### Phase 3: Basic API (When Needed)

- [ ] `GET /api/organizations` - List user's organizations
- [ ] `GET /api/organizations/[slug]` - Get org details
- [ ] `POST /api/organizations` - Create org (platform admin only initially)
- [ ] `GET /api/organizations/[slug]/members` - List members
- [ ] `POST /api/organizations/[slug]/members` - Add member (org admin)
- [ ] `DELETE /api/organizations/[slug]/members/[userId]` - Remove member

### Phase 4: Org Admin Panel (When Needed)

- [ ] `/dashboard/org/[slug]` - Org dashboard
- [ ] `/dashboard/org/[slug]/members` - Member management
- [ ] `/dashboard/org/[slug]/settings` - Org settings
- [ ] Organization switcher in sidebar (for users in multiple orgs)

### Phase 5: Org Content Management (When Needed)

- [ ] Filter collections by org in content library
- [ ] "Create in Organization" option when creating collections
- [ ] Org-scoped file storage bucket path
- [ ] Org content permissions (OrganizationSkriptPermission)

### Phase 6: Billing Integration (When Needed)

- [ ] Subscription model linked to Organization
- [ ] Stripe integration with org as customer
- [ ] Usage tracking per organization
- [ ] Billing admin UI

---

## Open Questions

1. **Can a collection move between personal and org?**
   - Probably yes - just update `organizationId`
   - Need to handle permission implications

2. **Can users be in multiple orgs?**
   - Yes, via multiple `OrganizationMember` records
   - Need org switcher in UI

3. **Who can create organizations?**
   - Initially: platform admins only
   - Later: self-service with approval or payment

4. **Org URL structure?**
   - Option A: `/org/gymkirchenfeld/...`
   - Option B: `gymkirchenfeld.eduskript.org/...` (subdomain - more complex)
   - Recommend Option A for simplicity

---

## Files to Modify (Phase 1 Only)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add Organization, OrganizationMember; modify Collection, User |
| `src/types/index.ts` | Add Organization, OrganizationMember types |

**Estimated effort:** ~30 minutes for schema + types

---

## References

- Current permission system: `src/lib/permissions.ts`
- Current admin system: `src/lib/admin-auth.ts`
- Current auth: `src/lib/auth.ts`
- Class system (similar pattern): `Class`, `ClassMembership` models
