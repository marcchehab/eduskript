# Re-fetch and Polling Mechanisms Analysis

*Analysis of data refresh patterns and SSE migration opportunities*

## Current Mechanisms

### 1. Pending Invitations - Visibility Change Handler

**File:** `src/hooks/use-pending-invitations.ts:73-78`

**What it does:** Re-fetches `/api/classes/my-classes?checkOnly=true` every time the browser tab becomes visible.

**SSE Status:** Already receives `class-invitation` events via SSE (primary mechanism).

**Recommendation:** KEEP as fallback
- Safety net for missed SSE events (connection drops, backgrounded tabs)
- The fetch is lightweight (returns boolean, not full data)
- Could remove if SSE proves 100% reliable over time

---

### 2. Quiz Progress Bar - 10-second Polling (REMOVED)

**File:** `src/components/markdown/quiz-progress-bar.tsx`

**Previous behavior:** Polled quiz responses every 10 seconds when the progress bar was expanded.

**SSE Status:** Now uses `quiz-submission` events via SSE.

**Status:** MIGRATED to SSE
- Teachers receive instant updates when students submit quiz answers
- No more polling - purely event-driven refresh
- Events published from `/api/user-data/sync` when quiz data with `isSubmitted: true` is saved

---

### 3. Import Job Status - 1-second Polling

**File:** `src/components/dashboard/import-export-settings.tsx:50-87`

**What it does:** Polls job status every 1 second during active import operations.

**SSE Status:** No event type defined.

**Recommendation:** KEEP
- Only runs during user-initiated imports (not continuous)
- Infrequent operations, low impact
- Could add `import-progress` event type later if needed

---

### 4. Rate Limit Cleanup - 60-second Interval

**File:** `src/lib/rate-limit.ts:23-31`

**What it does:** Server-side cleanup of expired rate-limit entries.

**Recommendation:** KEEP
- Server-side memory management, not user-facing
- Unrelated to SSE

---

### 5. SSE Keep-Alive Ping - 30-second Interval

**File:** `src/app/api/events/stream/route.ts:100-107`

**What it does:** Sends ping to keep SSE connection alive.

**Recommendation:** KEEP
- Required SSE infrastructure
- Prevents proxy/load balancer timeouts

---

## Summary Table

| Mechanism | Location | Interval | Status | Notes |
|-----------|----------|----------|--------|-------|
| Visibility handler | use-pending-invitations.ts | On tab focus | Keep | Fallback for SSE |
| Quiz polling | quiz-progress-bar.tsx | 10 sec | **Removed** | Replaced with SSE |
| Import job polling | import-export-settings.tsx | 1 sec | Keep | Infrequent, user-initiated |
| Rate limit cleanup | rate-limit.ts | 60 sec | Keep | Server-side only |
| SSE keep-alive | events/stream/route.ts | 30 sec | Keep | SSE infrastructure |

---

## SSE Event Types in Use

1. **`class-invitation`** - When student is invited to a class (bulk import)
2. **`quiz-submission`** - When student submits a quiz answer
3. **`teacher-annotations-update`** - (Defined, not yet implemented)
4. **`collaboration-request`** - (Defined, not yet implemented)
