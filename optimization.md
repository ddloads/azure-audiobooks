# Azure Audiobooks Optimization Notes

Last updated: 2026-06-03

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
- Added opportunistic cleanup for old cached cover thumbnails, keeping the cache bounded by age and file count.
- Optimized primary logo assets used by favicon/manifest/player fallback.

Impact: reduces image transfer, image decode cost, repeated resize work, and unbounded thumbnail cache growth.

### Mobile App Distribution

- Added `/api/mobile-app/latest` and `/api/mobile-app/latest.apk`.
- Added `npm run publish:azure-player-apk` to copy the newest Azure Player release APK into `server/data/mobile`.
- Added a Connect Mobile App modal download button.

Impact: users can get the native Android client directly from the server without a separate manual file handoff.

### Filter Facets

- Deferred `/api/library/filters` until the filter panel is opened.
- Increased filter option cache lifetime from 30 seconds to 10 minutes.
- Moved publisher, language, year, and narrator facets to DB-level distinct queries.
- Moved comma-delimited genre/tag facet expansion into Postgres with `regexp_split_to_table`, so the server no longer loads every visible book's `genres` and `tags` strings just to build filter options.

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

### Recommendation Caching

- Added a short per-user in-memory cache for `/api/recommendations`.
- Invalidated the current user's cache after progress updates/deletes.
- Invalidated all recommendation caches after library scan completion and admin book mutations that can change recommendation candidates or scoring.

Impact: repeat Home page visits avoid recomputing recommendation lanes while still refreshing after progress and library changes.

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

### Runtime Caching Headers

- Added long-lived immutable cache headers for hashed Vite assets under `/assets/`.
- Kept app shell HTML revalidated with `no-cache, must-revalidate` so deployments are picked up promptly.
- Kept service worker files uncached with `no-cache, no-store, must-revalidate`.
- Set the web app manifest to revalidate instead of being stored indefinitely.
- Set `/api/mobile-app/latest` to revalidate and `/api/mobile-app/latest.apk` to a short one-hour public cache.

Impact: fewer repeat static downloads while avoiding stale app shells, PWA service workers, and APK manifests.

### Compression

- Enabled gzip at the Nginx client/proxy layer for static text assets and proxied JSON/API responses.
- Covered JS, CSS, JSON, web manifest, WASM, SVG, XML, fonts, and plain text responses.

Impact: smaller network transfer for API responses and app assets when served through the deployed client container.

### Realtime Admin Progress

- Restricted the global scan/silence progress Socket.IO connection to admin users only.
- Non-admin sessions now keep the provider mounted for shared layout compatibility but do not open the scan progress socket.
- Admin-only settings still opens its runtime task socket when admins enter that screen.

Impact: reduces idle realtime connections and scan-progress fanout for normal listener sessions.

## Remaining High-Impact Work

### 1. Normalize Multi-Value Facets

`genres` and `tags` are still stored as comma-delimited strings. Filter option generation now splits them inside Postgres instead of Node, which removes the full metadata-row transfer. A future normalized table for tags/genres would still improve exact-match filtering semantics and indexing for filtered library queries.

Expected impact: cleaner filtering semantics and better index support for genre/tag filters at very large scale.

## Lower-Priority Follow-Ups

- Keep duplicate detection strictly on demand.
- Split the large `Library.tsx` and `BookMetadataModal.tsx` components to reduce maintenance risk before deeper performance work.

## Suggested Next Order

1. Normalize tags/genres into dedicated tables if exact genre/tag filter semantics or indexed filtering become necessary at very large scale.
2. Keep duplicate detection strictly on demand.
