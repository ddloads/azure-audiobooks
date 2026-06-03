# Azure Audiobooks Optimization Notes

Last updated: 2026-06-02

## Audit Coverage

Recent performance work was driven by Lighthouse runs against the hosted app, manual browser inspection, and code-level review of the highest-traffic routes. The user and admin account audits both pointed to the same broad issues: large library startup work, heavy cover/media transfer, and a large initial frontend bundle.

The raw Lighthouse report files were not committed to this repository, so this document records the actionable findings and remediation plan rather than exact historical score tables.

## Shipped Optimizations

### Library Loading

- Added server-side pagination for `/api/library`.
- Changed the Library page to fetch the first page only, then load later pages when the user scrolls or presses `Show more`.
- Kept the total library count from the server so the UI can show the real catalog size without downloading every title first.

Impact: reduces initial library payload and client state work for large catalogs.

### Series Overview

- Added a dedicated `/api/library/series` overview endpoint.
- Stopped building the full series overview from the complete book list on the client.
- Added chunked rendering for series cards.

Impact: the Series view no longer needs the full library payload just to show series cards.

### Cover Images

- Added `coverUrl()` on the client to request sized cover images with `?w=`.
- Updated the main cover surfaces to request width-appropriate thumbnails.
- Added server-side thumbnail caching in `server/data/cache/covers`.
- Optimized primary logo assets used by favicon/manifest/player fallback.

Impact: reduces image transfer, image decode cost, and repeated resize work.

### Mobile App Distribution

- Added `/api/mobile-app/latest` and `/api/mobile-app/latest.apk`.
- Added `npm run publish:azure-player-apk` to copy the newest Azure Player release APK into `server/data/mobile`.
- Added a Connect Mobile App modal download button.

Impact: users can get the native Android client directly from the server without a separate manual file handoff.

### Filter Facets

- Deferred `/api/library/filters` until the filter panel is opened.
- Increased filter option cache lifetime from 30 seconds to 10 minutes.
- Moved publisher, language, year, and narrator facets to DB-level distinct queries.
- Kept genre/tag splitting in Node because those values are comma-delimited strings in the current schema.

Impact: removes one normal library-startup API call and reduces backend memory work when filters are requested.

### Frontend Code Splitting

- Lazy-loaded top-level route pages through `React.lazy` and `Suspense`.
- Split admin-only routes, duplicate management, and mobile menu into separate chunks.
- Lazy-loaded heavy modal flows including metadata editing, quick match, upload, bug reporting, connect mobile, and admin settings.

Impact: reduces the initial JavaScript bundle and defers parsing/compilation for admin and modal workflows until users actually open them.

### Progress Data Scope

- Added current-user progress to `/api/library` book responses.
- Changed the Library page to hydrate card progress from paged library results.
- Removed the Library page's startup fetch of the full `/api/progress` response.

Impact: removes a library-entry API call and avoids building a full progress map for books that are not loaded on the current page.

### Database Index Review

- Confirmed existing indexes for `Book.createdAt`, `Book.authorId`, `Book.seriesId`, `Book.libraryId`, `Book.year`, and `Progress` user/book lookups.
- Added Prisma migration indexes for `Book.title` and `Book.duration`.
- Confirmed the compound `Progress.userId, Progress.bookId` lookup is covered by the existing unique constraint.

Impact: improves common title and duration sorts while documenting the existing index coverage.

### Library Virtualization

- Added dependency-free window virtualization for loaded Library books in grid and list modes.
- Kept existing server pagination and `Show more` behavior while only mounting visible book rows/cards plus overscan.
- Added fixed virtual row/card sizing rules for stable scroll math and clamped grid-card metadata to avoid row-height drift.

Impact: reduces mounted React elements during large loaded library sessions and should improve scroll smoothness and memory use.

## Remaining High-Impact Work

### 1. Normalize Multi-Value Facets

`genres` and `tags` are stored as comma-delimited strings, so accurate facet queries require string splitting. A normalized table for tags/genres would let the database build facets and filters without loading those fields into Node.

Expected impact: faster filter option generation and cleaner filtering semantics.

### 2. Recommendation Caching

Cache `/api/recommendations` per user for a short TTL and invalidate on progress/library changes.

Expected impact: faster Home page loads.

### 3. Runtime Caching Headers

Review proxy/server cache headers for:

- cover thumbnails
- static frontend assets
- APK downloads
- service worker update behavior

Expected impact: fewer repeat downloads and faster repeat visits.

### 4. Compression

Confirm gzip or Brotli is enabled at the deployed proxy for JSON, JS, CSS, and manifest responses.

Expected impact: smaller network transfer for API responses and app assets.

## Lower-Priority Follow-Ups

- Add cleanup for old cached cover thumbnails.
- Avoid opening scan/write-tag sockets for non-admin users when possible.
- Keep duplicate detection strictly on demand.
- Split the large `Library.tsx` and `BookMetadataModal.tsx` components to reduce maintenance risk before deeper performance work.

## Suggested Next Order

1. Normalize tags/genres if filter generation remains expensive at scale.
2. Add recommendation caching.
3. Review runtime cache headers and deployed compression.
