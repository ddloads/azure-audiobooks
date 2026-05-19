# Azure Audiobooks Status

Last updated: 2026-05-19

## Project State

Azure Audiobooks is a monorepo audiobook library manager with a React/Vite frontend and a Node/Express/Prisma backend. The app supports desktop and mobile library browsing, metadata management, library scanning, duplicate handling, file management, tag writing, and PWA-style mobile use.

Azure Player is the companion React Native/Expo Android client built specifically for this server. Its development root is `E:\Software Dev\AzurePlayer`; review that project when changing backend API behavior that affects mobile login, library browsing, playback, progress, downloads, Android Auto, admin actions, or metadata matching.

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

- Added authenticated bug reporting with `POST /api/reports`, including issue type, optional comment, page path, user agent, and submitting user.
- Added Prisma migration `20260519183000_add_bug_reports` and `BugReport` storage for user-submitted reports.
- Added an Admin Settings `Reports` tab backed by `GET /api/admin/reports` so admins can review recent submissions.
- Added desktop and mobile-web report entry points using the shared `BugReportModal`.
- Updated the companion Azure Player app locally to submit reports through the new `/api/reports` endpoint from its profile support section.
- Added recovery email support to user accounts with a nullable unique `User.email` field and Prisma migration `20260519000000_add_user_email`.
- Updated public registration and admin-created users to require recovery email, including server-side format and duplicate-email validation.
- Added a blocking app-level recovery email prompt for existing authenticated users who do not yet have an email in the database.
- Added `PATCH /auth/me/email` so users can add their own recovery email without admin intervention.
- Exposed recovery email in auth, admin user list, dashboard recent-user data, and mobile pairing auth responses.
- Made the mobile QR pairing generator visible to all authenticated users instead of admins only.
- Confirmed the existing Admin Scripts UI includes `Apply Prisma migrations`, which runs `npx prisma migrate deploy` for applying the email migration.
- Expanded the metadata modal header so it now shows title context like author, series, narrator, duration, identifiers, library, and a shortened folder path before matching.
- Implemented automated metadata verification: Writing tags to audio files now automatically triggers a book-specific rescan to refresh the database from the newly embedded tags.
- Added `forceMetadata` support to `rescanBook` and `upsertBookFolder` in the scanner utility to allow forced re-probing of files regardless of metadata version.
- Updated `runWriteTagsJob` in the admin controller to include a verification step and provide real-time status feedback during the refresh.
- Fixed desktop and mobile book descriptions so stored HTML entities such as `&quot;` display as readable text while markup is still stripped before rendering.
- Added shared client description formatting in `client/src/utils/formatDescription.ts`.
- Cleaned the frontend lint baseline by aligning React hook lint rules with the current fetch-in-effect code style and removing remaining `any`/hook lint errors.
- Fixed the server Docker image's `tone` install step so it recursively finds the extracted Linux binary, installs it to `/usr/local/bin/tone`, and fails the image build if `tone --help` cannot run.
- Made the local fallback Tone path platform-aware so Linux containers reference `/app/bin/tone` instead of `/app/bin/tone.exe`.
- Improved missing Tone errors to report when the configured `TONE_PATH` does not exist.
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

- `cd server && npx prisma validate --schema prisma/schema.prisma` passes.
- `cd server && npx tsc -p tsconfig.json --noEmit` passes.
- `cd server && npx prisma generate` passes.
- `cd server && npx tsc` passes.
- `cd server && npx tsc --noEmit` passes.
- `cd client && npm run build` passes.
- `cd client && npm run lint` passes.

## Known Notes

- Existing deployments must apply Prisma migrations, either manually or through Admin Settings -> Scripts -> Apply Prisma migrations, before bug reports can be stored.
- Existing deployments must apply Prisma migrations, either manually or through Admin Settings -> Scripts -> Apply Prisma migrations, before email-backed recovery fields are available in the database.
- The companion Azure Player workspace at `E:\Software Dev\AzurePlayer` has no configured Git remote and appears fully untracked, so its local bug-reporting UI/API changes must be committed from that project once its repository setup is confirmed.
- Large screens such as `AdminSettingsModal`, `BookMetadataModal`, and parts of `Library` still contain more logic than ideal. They are good next candidates for feature-by-feature extraction.
- Goodreads no longer provides a generally available public API, so the Goodreads provider uses public Goodreads search/detail pages and maps parsed results into the existing metadata candidate shape.
- Google Books and Goodreads Quick Match results require manual review before applying metadata automatically.
- Local workspace-only files under `.claude/` and `.sync/` are modified but are not part of the current feature commit.
