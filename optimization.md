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

## Remaining High-Impact Work

### 1. Frontend Code Splitting

The initial JavaScript bundle remains large. Lazy-load heavy flows:

- `BookMetadataModal`
- `QuickMatchModal`
- `UploadModal`
- `BugReportModal`
- admin settings/pages
- duplicate management

Expected impact: faster first load and less JS parse/compile time, especially on mobile.

### 2. Library Virtualization

The Library page now fetches incrementally, but rendered book cards are still normal React elements. Add list/grid virtualization so only visible items render.

Expected impact: smoother scrolling and lower memory use for large loaded result sets.

### 3. Progress Data Scope

The client still fetches full `/api/progress` for library card progress. Add current-user progress to paged `/api/library` responses or expose a paged progress lookup.

Expected impact: fewer requests and less client-side map construction on library entry.

### 4. Database Index Review

Add or confirm indexes for common filters/sorts:

- `Book.createdAt`
- `Book.title`
- `Book.authorId`
- `Book.seriesId`
- `Book.libraryId`
- `Book.duration`
- `Book.year`
- `Progress.userId`
- compound `Progress.userId, Progress.bookId`

For PostgreSQL search at larger scale, consider trigram or full-text indexes for title/author/series/narrator search.

Expected impact: faster filtered and sorted library queries.

### 5. Normalize Multi-Value Facets

`genres` and `tags` are stored as comma-delimited strings, so accurate facet queries require string splitting. A normalized table for tags/genres would let the database build facets and filters without loading those fields into Node.

Expected impact: faster filter option generation and cleaner filtering semantics.

### 6. Recommendation Caching

Cache `/api/recommendations` per user for a short TTL and invalidate on progress/library changes.

Expected impact: faster Home page loads.

### 7. Runtime Caching Headers

Review proxy/server cache headers for:

- cover thumbnails
- static frontend assets
- APK downloads
- service worker update behavior

Expected impact: fewer repeat downloads and faster repeat visits.

### 8. Compression

Confirm gzip or Brotli is enabled at the deployed proxy for JSON, JS, CSS, and manifest responses.

Expected impact: smaller network transfer for API responses and app assets.

## Lower-Priority Follow-Ups

- Add cleanup for old cached cover thumbnails.
- Avoid opening scan/write-tag sockets for non-admin users when possible.
- Keep duplicate detection strictly on demand.
- Split the large `Library.tsx` and `BookMetadataModal.tsx` components to reduce maintenance risk before deeper performance work.

## Suggested Next Order

1. Lazy-load heavy modals and admin-only UI.
2. Include paged user progress in `/api/library`.
3. Add database indexes through Prisma migration.
4. Add library grid/list virtualization.
5. Normalize tags/genres if filter generation remains expensive at scale.
