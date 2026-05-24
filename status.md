# Azure Audiobooks Status

Last updated: 2026-05-23

## Project State

Azure Audiobooks is a monorepo audiobook library manager with a React/Vite frontend and a Node/Express/Prisma backend. The app supports desktop and mobile library browsing, metadata management, library scanning, duplicate handling, file management, tag writing, and PWA-style mobile use.

Azure Player is the companion React Native/Expo Android client built specifically for this server. Its development root is `E:\Software Dev\AzurePlayer`; review that project when changing backend API behavior that affects mobile login, library browsing, playback, progress, downloads, Android Auto, admin actions, or metadata matching.

The frontend uses a feature-module structure. Admin UI lives under `client/src/features/admin/` (per-tab components, helpers, types). Shared metadata contracts live under `client/src/features/metadata/`. Quick Match UI lives under `client/src/features/quick-match/`. The entire app now routes through a single `AppShell` component (collapsible sidebar, fixed topbar, unified player tray) instead of separate desktop/mobile layout shells.

## Current Features

- Unified app shell: collapsible sidebar (220px ↔ 64px icon-only; overlay drawer on mobile), fixed 64px topbar with brand mark + wordmark, user avatar pill with role-aware dropdown.
- Home page (`/`) with Continue Listening, Up Next in Series, You Might Like shelves, and empty-state CTA. Full library grid at `/library`.
- Content-based recommendation system: "Up Next in Series" picks the next unread book after a finished series entry; "You Might Like" scores candidates by shared author/narrator/genre against finished books.
- Library browsing with grid, list, and mobile-focused views.
- Search, sorting, and filters for library, author, series, cover status, identifiers, abridged status, file type, listening status, match status, and potential duplicates.
- Mobile library experience with persistent view mode, selection controls, filters, continue-listening shelf, and mobile playback UI.
- Unified PlayerTray (replaces old Player + MobilePlayer): collapsed mini row and expanded panel with seek bar, skip-15/30, speed, sleep timer, smart chapters menu, and volume. Works on all platforms.
- Smart chapters: server-side `chapterizer.ts` extracts chapter boundaries from embedded metadata; chapters are displayed and seekable in the player tray.
- Book detail pages with metadata, cover art, playback progress, file actions, duplicate tools, and maintenance actions. Desktop tools menu now includes a direct Match Metadata entry.
- Admin settings split into per-domain tab components under `client/src/features/admin/`: Overview, Libraries, Users, Appearance, Logs, Scripts, System, Reports.
- Server admin controller split into domain modules under `server/src/controllers/admin/`.
- Library scanning through a queued worker pool with realtime progress updates and stop support.
- File manager and upload flows for administering library files.
- Duplicate detection and merge workflows, with clickable book titles in the Duplicates page.
- Manual metadata matching with selectable fields and cover preview.
- Batch manual matching with queue navigation and optional automatic search between queued titles.
- Quick Match workflow for unmatched titles, including preview/apply modes, selectable fields, confidence threshold, quick-matched tagging, and quick-matched filtering.
- Metadata providers currently available in match flows:
  - Audible.com
  - Google Books
  - Goodreads
  - Audible + Google combined search

## Latest Changes

### 2026-05-23
- Fixed player tray secondary buttons (speed, sleep, volume, close) rendering outside the panel border. Shell.css set `height: 68px` on `.player-tray` but `globals.css` applied `overflow: visible` without overriding the height; the `.tray-static` child's `min-height: 104px` caused the buttons to overflow beyond the panel background. Fixed by adding `height: auto` to `.player-tray` in `globals.css` and overriding `.shell-main.has-player` bottom padding to `120px` to account for the taller tray.

### 2026-05-22
- Built unified `AppShell` component replacing separate desktop/mobile layout shells. `TopBar` (fixed 64px, brand mark, user dropdown), `Sidebar` (collapsible 220px ↔ 64px on desktop; overlay drawer on mobile), and `PlayerTray` (mini collapsed row + expanded panel) are all new standalone components. `shell.css` added as a dedicated layout stylesheet.
- Rebuilt `PlayerTray` as a single cross-platform player replacing the old `Player` component and `MobilePlayer` full-screen overlay. Collapsed mini row (68px) shows cover/title/basic controls; expanded panel (292px) adds seek bar, skip-15/30, speed, sleep timer, chapters popup, and volume.
- Added Home page at `/`; moved full library grid to `/library`. Home shows Continue Listening, Up Next in Series, You Might Like shelves.
- Added `chapterizer.ts` server utility to extract chapter boundary data from embedded audio metadata; chapters are indexed to books during scanning and exposed for seeking in the player tray chapters popup.
- Added content-based recommendation engine (`server/src/controllers/recommendationController.ts`, `GET /api/recommendations`). "Up Next in Series" and "You Might Like" shelves appear on the Home page.
- Split monolithic `adminController.ts` into domain modules under `server/src/controllers/admin/` (`adminDashboardController`, `adminBookController`, `adminLibraryController`, `adminUserController`, `adminAudibleController`, `adminFileController`, `shared`). `AdminSettingsModal` similarly extracted into `client/src/features/admin/` with per-tab components, `helpers.ts`, and `types.ts`.
- Added Match Metadata entry to desktop book tools menu (`BookDetailsPage`), opening the metadata modal directly on the match tab.
- Premium visual upgrade: topbar height 52→64px, logo SVG and wordmark scaled up with luminous gradient, cyan glow hairline on topbar, sidebar active item gradient + glowing left-bar + icon glow, player tray glass depth + bloom shadow on play button, card hover lift with glow ring, ambient body background orbs, route entry slide-up animation.
- Fixed hamburger toggle: collapses/expands sidebar on desktop, opens/closes overlay drawer on mobile.
- Fixed auto-search firing when switching to Match tab with the toggle already enabled.
- Improved duplicate detection scoring; book titles in the Duplicates page are now clickable links.
- Fixed player streaming compatibility: updated `streamController` range-request handling and aligned `PlayerTray` seek/progress state.
- Fixed player tray overflow clipping so the tray panel background correctly contains all content.

### 2026-05-21 and earlier
- Regenerated the Prisma client after the `add_user_email` migration added `User.email`; the stale generated client was missing the field, causing TypeScript errors in `authController.ts`.
- Fixed Quick Match apply silently failing with a database unique-constraint error (P2002) when two books in the same library would end up with the same title and author after matching. `applyMatchedFieldsToBook` now mirrors the disambiguation retry logic from `applyBookMatch`: on a `[libraryId, title, authorId]` collision it appends the folder basename to the title and retries the update.
- Added `title` to the `book` parameter type of `applyMatchedFieldsToBook` so the original title is available for the disambiguation fallback.
- Added authenticated bug reporting with `POST /api/reports`, including issue type, optional comment, page path, user agent, and submitting user.
- Added Prisma migration `20260519183000_add_bug_reports` and `BugReport` storage for user-submitted reports.
- Added an Admin Settings `Reports` tab backed by `GET /api/admin/reports` so admins can review recent submissions.
- Added desktop and mobile-web report entry points using the shared `BugReportModal`.
- Added contextual report buttons on desktop and mobile-web title detail pages, prefilled with the current title and author.
- Updated the companion Azure Player app locally to submit reports through the new `/api/reports` endpoint from its profile support section.
- Updated the companion Azure Player app locally with a title detail report button that submits `azure-player://book/:id` context.
- Added recovery email support to user accounts with a nullable unique `User.email` field and Prisma migration `20260519000000_add_user_email`.
- Updated public registration and admin-created users to require recovery email, including server-side format and duplicate-email validation.
- Added a blocking app-level recovery email prompt for existing authenticated users who do not yet have an email in the database.
- Added `PATCH /auth/me/email` so users can add their own recovery email without admin intervention.
- Exposed recovery email in auth, admin user list, dashboard recent-user data, and mobile pairing auth responses.
- Made the mobile QR pairing generator visible to all authenticated users instead of admins only.
- Expanded the metadata modal header so it now shows title context like author, series, narrator, duration, identifiers, library, and a shortened folder path before matching.
- Implemented automated metadata verification: writing tags to audio files now automatically triggers a book-specific rescan to refresh the database from the newly embedded tags.
- Added `forceMetadata` support to `rescanBook` and `upsertBookFolder` in the scanner utility to allow forced re-probing of files regardless of metadata version.
- Fixed desktop and mobile book descriptions so stored HTML entities such as `&quot;` display as readable text while markup is still stripped before rendering.
- Added shared client description formatting in `client/src/utils/formatDescription.ts`.
- Fixed the server Docker image's `tone` install step so it recursively finds the extracted Linux binary, installs it to `/usr/local/bin/tone`, and fails the image build if `tone --help` cannot run.
- Made the local fallback Tone path platform-aware so Linux containers reference `/app/bin/tone` instead of `/app/bin/tone.exe`.
- Extracted reusable metadata types, provider labels/options, and Quick Match types into `client/src/features/metadata/` and `client/src/features/quick-match/`.
- Moved the Quick Match modal UI into `client/src/features/quick-match/QuickMatchModal.tsx`.
- Added Goodreads as a metadata match source provider with a server-side adapter at `server/src/utils/goodreads.ts`; wired into manual match search and Quick Match (manual-review only).

## Validation

- `cd server && npx prisma validate --schema prisma/schema.prisma` passes.
- `cd server && npx tsc -p tsconfig.json --noEmit` passes.
- `cd server && npx prisma generate` passes.
- `cd server && npx tsc` passes.
- `cd server && npx tsc --noEmit` passes.
- `cd client && npm run build` passes.
- `cd client && npm run lint` passes.

## Known Notes

- Existing deployments must apply Prisma migrations (Admin Settings → Scripts → Apply Prisma migrations) before bug reports or email recovery fields are available in the database.
- The companion Azure Player workspace at `E:\Software Dev\AzurePlayer` has no configured Git remote and appears fully untracked, so its local bug-reporting UI/API changes must be committed from that project once its repository setup is confirmed.
- `BookMetadataModal` and parts of `Library` still contain more logic than ideal and are good candidates for continued feature-by-feature extraction.
- Goodreads no longer provides a generally available public API, so the Goodreads provider uses public search/detail pages and maps parsed results into the existing metadata candidate shape.
- Google Books and Goodreads Quick Match results require manual review before applying metadata automatically.
- The old `Player` component and `MobilePlayer` full-screen overlay are superseded by `PlayerTray` but may still be imported in some mobile-only paths; verify before removing them.
- Local workspace-only files under `.claude/` and `.sync/` are modified but are not part of feature commits.
