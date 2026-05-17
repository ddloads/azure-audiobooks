# Azure Audiobooks Status

Last updated: 2026-05-17

## Project State

Azure Audiobooks is a monorepo audiobook library manager with a React/Vite frontend and a Node/Express/Prisma backend. The app supports desktop and mobile library browsing, metadata management, library scanning, duplicate handling, file management, tag writing, and PWA-style mobile use.

The frontend is moving toward a feature-module structure. Shared metadata contracts now live under `client/src/features/metadata/`, and the Quick Match UI now lives under `client/src/features/quick-match/` instead of being embedded directly in the main library page.

## Current Features

- Library browsing with grid, list, and mobile-focused views.
- Search, sorting, and filters for library, author, series, cover status, identifiers, abridged status, file type, listening status, match status, and potential duplicates.
- Mobile library experience with persistent view mode, selection controls, filters, continue-listening shelf, and mobile playback UI.
- Book detail pages with metadata, cover art, playback progress, file actions, duplicate tools, and maintenance actions.
- Admin settings for libraries, users, appearance, logs, maintenance scripts, Audible CLI status, and scan controls.
- Library scanning through a queued worker pool with realtime progress updates and stop support.
- File manager and upload flows for administering library files.
- Duplicate detection and merge workflows.
- Manual metadata matching with selectable fields and cover preview.
- Batch manual matching with queue navigation and optional automatic search between queued titles.
- Quick Match workflow for unmatched titles, including preview/apply modes, selectable fields, confidence threshold, quick-matched tagging, and quick-matched filtering.
- Metadata providers currently available in match flows:
  - Audible.com
  - Google Books
  - Goodreads
  - Audible + Google combined search

## Latest Changes

- Extracted reusable metadata types into `client/src/features/metadata/types.ts`.
- Centralized metadata provider labels/options and candidate source labeling in `client/src/features/metadata/providers.ts`.
- Extracted Quick Match types, field defaults, and field labels into `client/src/features/quick-match/types.ts`.
- Moved the Quick Match modal UI into `client/src/features/quick-match/QuickMatchModal.tsx`.
- Reduced `client/src/pages/Library.tsx` by moving Quick Match rendering and provider option details out of the page component.
- Updated `BookMetadataModal` and mobile library code to use shared metadata types instead of importing types from a UI component.
- Added Goodreads as a metadata match source provider.
- Added a server-side Goodreads adapter at `server/src/utils/goodreads.ts`.
- Wired Goodreads into manual metadata search at `/admin/books/:bookId/match/search`.
- Wired Goodreads into the Quick Match provider parser and search path.
- Added Goodreads to the manual metadata provider dropdown.
- Added Goodreads to the Quick Match provider dropdown.
- Updated manual match result source labels so selected Goodreads candidates link back as `Goodreads`.
- Kept Goodreads Quick Match results as manual-review only because Goodreads does not provide reliable audiobook-specific match signals such as ASIN or duration.

## Validation

- `cd server && npx tsc --noEmit` passes.
- `cd client && npm run build` passes.
- `cd client && npm run lint` currently fails on existing unrelated React hook and `any` lint issues across the client codebase.

## Known Notes

- Large screens such as `AdminSettingsModal`, `BookMetadataModal`, and parts of `Library` still contain more logic than ideal. They are good next candidates for feature-by-feature extraction.
- Goodreads no longer provides a generally available public API, so the Goodreads provider uses public Goodreads search/detail pages and maps parsed results into the existing metadata candidate shape.
- Google Books and Goodreads Quick Match results require manual review before applying metadata automatically.
- Local workspace-only files under `.claude/` and `.sync/` are modified but are not part of the current feature commit.
