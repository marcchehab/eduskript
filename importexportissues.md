# Import/Export Issues

## Issue 1: Org Route Access Control Bug (CRITICAL) - FIXED

**Found:** 2025-12-26
**Fixed:** 2025-12-26

**Problem:** Content is accessible via `/org/[orgSlug]/c/...` routes even when that content is NOT configured in the org's page layout.

**Root Cause:** `src/lib/cached-queries.ts:getOrgPublishedPage()` only checked if collection author was org admin, not if collection was in page layout.

**Fix Applied:**
- Added page layout check at start of `getOrgPublishedPage()`
- Verifies collection ID is in `org_page_layout_items` before allowing access
- Added 5 unit tests to prevent regression

---

## Issue 2: Missing Files in Scaleway Bucket - FIXED

**Found:** 2025-12-26
**Fixed:** 2025-12-26

**Problem:** Files were imported to database but not uploaded to S3 bucket when using direct script import instead of zip import.

**Fix Applied:**
- Re-imported using proper zip import which uploads files to S3
- Files now in SCW_TEACHER_BUCKET

---

## Issue 3: Video Records Not Created During Import - FIXED

**Found:** 2025-12-26
**Fixed:** 2025-12-26

**Problem:** Export contains `.mp4.json` files with Mux video metadata (playbackId, poster, blurDataURL), but the import script doesn't create `Video` records from them.

**Symptoms:**
- Videos show "Video not found: {filename}.mp4"
- Message: "Make sure the video has been uploaded to Mux"

**Root Cause:** Import script (`src/app/api/import/route.ts`) processes `.mp4.json` files as regular attachments but doesn't parse them to create Video records.

**Fix Applied:**
- Created `scripts/import-videos.mjs` to import video metadata from exported files
- Script finds all `.mp4.json` files, parses Mux metadata, creates Video records
- Successfully imported 70 videos

**Future Fix:** Import script should be updated to handle `.mp4.json` files automatically.

---

## Issue 4: Custom MDX Components Not Supported - MOSTLY FIXED

**Found:** 2025-12-26
**Status:** MOSTLY FIXED - Components mapped, 4 pages still need SQLQuestion

**Problem:** Some pages use custom JSX/MDX components from informatikgarten.

**Fixes Applied:**
- Removed `import { Tabs } from 'nextra/components'` statements (eduskript has Tabs)
- Removed `import { Question } from 'shared/components/Quiz'` statements (eduskript has Question/Option)
- Removed `<IsNotAuthenticated>`, `<IsAuthenticated>`, `<FeatherIcon>` blocks (info-only content)
- Removed `import { DemoButton } from './DemoButton'` and `<DemoButton />` usage
- Fixed `./attachments/` path prefix in markdown (8 pages)
- Re-published fixed pages
- Added collections to org page layout (grundjahr, weitere-inhalte)

**Fixed & Working:**
- `daten-und-informationen` - Quiz components work
- `von-neumann-architektur` - Tabs work
- `for-schleifen-verschachteln` - Tabs work
- `javascript-der-beginn-moderner-webapps` - DemoButton removed
- `farben` - ColorSliders component reimplemented
- `farben-umrechnen-rgb-zu-cmyk` - ColorSliders component reimplemented

**Still Unpublished (need SQLQuestion component):**
1. `aggregatsfunktionen` - Aggregatsfunktionen
2. `join-befehle` - Join-Befehle
3. `checkpoint-quiz` - Checkpoint-Quiz
4. `ueberblick-eibe` - Überblick EIBE

**Future Work:** Create SQLQuestion component or transform to SQL editor syntax

---

## Issue 5: Pages to Unpublish - DONE

**Found:** 2025-12-26
**Status:** DONE

**Problem:** All pages were published during import, including:
- Exam prep pages (Prufungsvorbereitung)
- Hall of Fame pages
- Entry tests (Eintrittstest)

**Fix Applied:**
- Unpublished 18 pages matching: examprep, prufungsvorbereitung, notes, hall-of-fame, eintrittstest

---

## Issue 6: Missing Images in Export - FIXED

**Found:** 2025-12-26
**Fixed:** 2025-12-26

**Problem:** 21 images referenced in markdown content were missing from the export. These existed in the source informatikgarten.ch repo but weren't included in the export.

**Fix Applied:**
- Created `scripts/find-missing-images.mjs` to scan DB for missing image references
- Created `scripts/upload-missing-images.mjs` to upload from source repo
- Successfully uploaded all 21 missing images from `/home/chris/git/informatikgarten.ch/sites/ig/content/`

**Missing Images (all fixed):**
- 12 files from `code/attachments/` → programmieren-1
- 4 files from `data/attachments/` → daten-information
- 1 file from `crypto/attachments/` → kryptologie
- 2 files from `microbit/attachments/` → robotik
- 1 file from `net/attachments/` → netzwerke-internet
- 1 file from `aufbau/attachments/` → building-an-adder

---

## Summary of Import Issues

| Issue | Status | Impact |
|-------|--------|--------|
| Access control bug | FIXED | Security - content visible via wrong routes |
| Missing S3 files | FIXED | Files not accessible |
| Video records missing | FIXED | Videos show "not found" |
| Custom MDX components | MOSTLY FIXED | 4 pages need SQLQuestion |
| Wrong publish state | FIXED | Non-educational content was public |
| Missing images in export | FIXED | 21 images uploaded from source |
