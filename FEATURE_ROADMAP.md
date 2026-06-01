# Azure Audiobooks Feature Roadmap & Implementation Brief

Use this document as a working prompt/spec for Codex, Claude Code, Gemini CLI, or another coding agent. The goal is to evolve Azure Audiobooks from a basic self-hosted audiobook server into a polished, immersive audiobook management and listening platform.

## Project Goal

Azure Audiobooks should become more than a standard audiobook grid/list application. The long-term direction is a self-hosted audiobook server with strong metadata management, advanced library organization, immersive playback, and an optional stylized 3D virtual bookshelf interface.

Primary product identity:

> A self-hosted audiobook server focused on organization, metadata quality, immersive browsing, and long-session listening UX.

## Major Feature Priorities

Recommended implementation order:

1. Library Scanner System
2. Metadata System
3. Playback and Progress Improvements
4. File/Folder Management Tools
5. Multi-Library and User Profiles
6. 3D Virtual Bookshelf View
7. Recommendation and Discovery System
8. Offline Sync and Mobile Features
9. AI-Powered Metadata and Search
10. Plugin/Connector Architecture

---

# 1. Advanced Library Scanner System

## Objective

Create a reliable background scanner that detects, indexes, and updates audiobook files without requiring full rescans every time.

## Features

- Real-time file watching
- Incremental scanning
- Full manual rescan
- Per-library scan queues
- Failed scan retry system
- Scan history and logs
- File change detection
- Deleted/moved file detection
- Duplicate file detection

## Suggested Tech

- Node.js worker process
- chokidar for filesystem watching
- BullMQ or similar job queue
- Redis for queue/cache support
- Prisma models for scan jobs and indexed files

## Suggested Pipeline

```text
File Discovery
    ↓
File Fingerprinting
    ↓
Metadata Extraction
    ↓
Cover Detection
    ↓
Chapter Detection
    ↓
Metadata Matching
    ↓
Database Update
    ↓
Frontend Notification
```

## Suggested Database Models

```prisma
model LibraryScanJob {
  id          String   @id @default(cuid())
  libraryId   String
  status      String
  startedAt   DateTime?
  finishedAt  DateTime?
  error       String?
  createdAt   DateTime @default(now())
}

model IndexedAudioFile {
  id             String   @id @default(cuid())
  libraryId      String
  bookId         String?
  path           String   @unique
  fileName       String
  extension      String
  sizeBytes      BigInt
  modifiedAt     DateTime
  checksum       String?
  durationSec    Int?
  codec          String?
  bitrate        Int?
  scanStatus     String
  lastScannedAt  DateTime?
}
```

## Coding Agent Tasks

- Add scanner service module.
- Add scan job database models.
- Add API endpoints for triggering scans and viewing scan status.
- Add admin UI scan dashboard.
- Add websocket events for scan progress.
- Add error handling and retry behavior.

---

# 2. Powerful Metadata System

## Objective

Make metadata one of Azure's strongest differentiators. Audiobooks need richer data than normal music libraries.

## Features

- Multiple authors
- Multiple narrators
- Series support
- Series order
- Edition support
- Publisher
- Release date
- Language
- ISBN
- ASIN
- Audible ID
- Google Books ID
- Cover variants
- Abridged/unabridged flag
- Explicit/content rating metadata
- Metadata confidence scoring

## Metadata Confidence Example

```text
Audible match: 97%
Google Books match: 84%
Filename match: 71%
Manual override: true
```

## Suggested Database Models

```prisma
model BookMetadataMatch {
  id          String   @id @default(cuid())
  bookId      String
  source      String
  sourceId    String?
  confidence  Float
  rawJson     Json?
  accepted    Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model Narrator {
  id      String @id @default(cuid())
  name    String @unique
  books   BookNarrator[]
}

model BookNarrator {
  bookId     String
  narratorId String

  @@id([bookId, narratorId])
}
```

## Coding Agent Tasks

- Expand book metadata schema.
- Add metadata source abstraction.
- Add metadata matching queue.
- Add manual metadata editor UI.
- Add admin review queue for low-confidence matches.
- Add cover search and replacement tools.

---

# 3. Chapter Intelligence

## Objective

Improve audiobook navigation and make long books easier to use.

## Features

- Chapter extraction from files
- Manual chapter editing
- Chapter merge/split tools
- Silence-based chapter detection
- Chapter titles
- Chapter progress tracking
- Smart bookmarks
- Optional AI-generated semantic chapter names

## Suggested Database Model

```prisma
model Chapter {
  id          String @id @default(cuid())
  bookId      String
  title       String
  startSec    Int
  endSec      Int?
  source      String
  sortOrder   Int
}
```

## Coding Agent Tasks

- Extract embedded chapters where available.
- Store chapter data in database.
- Display chapter list in player.
- Allow seeking by chapter.
- Add admin chapter editor.

---

# 4. Playback and Progress Improvements

## Objective

Make the player feel like a serious audiobook player, not a simple audio tag wrapper.

## Features

- Persistent playback queue
- Resume position per user
- Per-book completion percentage
- Sleep timer
- Playback speed presets
- Skip forward/back controls
- Chapter skip controls
- Bookmark support
- Listening history
- Cross-device progress sync
- Recently played shelf

## Suggested Database Models

```prisma
model UserBookProgress {
  id           String   @id @default(cuid())
  userId       String
  bookId       String
  positionSec  Int
  completed    Boolean  @default(false)
  completedAt  DateTime?
  updatedAt    DateTime @updatedAt

  @@unique([userId, bookId])
}

model Bookmark {
  id          String   @id @default(cuid())
  userId      String
  bookId      String
  positionSec Int
  note        String?
  createdAt   DateTime @default(now())
}
```

## Coding Agent Tasks

- Ensure progress is stored server-side.
- Sync progress via websocket or periodic API call.
- Add bookmarks API and UI.
- Add sleep timer.
- Add playback speed selector.
- Add player state persistence after refresh.

---

# 5. File/Folder Management System

## Objective

Allow admins to organize audiobook files directly from Azure without manually using the filesystem.

## Features

- Browse library folder tree
- Create folders
- Rename folders
- Rename files
- Move books
- Delete files/folders with confirmation
- Bulk rename
- Dry-run before applying bulk changes
- Undo log where possible
- Permission checks
- Prevent path traversal
- Prevent destructive operations outside configured libraries

## Example Rename Templates

```text
{Author}/{Series}/{SeriesIndex} - {Title}/{Title}.{ext}
{Author}/{Title} ({Year})/{Title}.{ext}
{Narrator}/{Author} - {Title}/{Title}.{ext}
```

## Coding Agent Tasks

- Create safe filesystem service.
- Add path validation.
- Add admin-only file manager API.
- Add dry-run rename engine.
- Add frontend folder browser and rename preview.
- Add operation log table.

---

# 6. Multi-Library System

## Objective

Support multiple independent audiobook libraries with different settings and permissions.

## Example Libraries

```text
Audiobooks
Kids
Podcasts
Language Learning
Archived
Family Shared
```

## Features

- Separate root paths
- Separate scan settings
- Separate metadata agents
- Separate permissions
- Separate visibility per user/profile
- Separate artwork/theme options

## Suggested Database Model

```prisma
model Library {
  id          String   @id @default(cuid())
  name        String
  rootPath    String
  type        String
  isEnabled   Boolean  @default(true)
  createdAt   DateTime @default(now())
}
```

## Coding Agent Tasks

- Add library model.
- Associate books/files with libraries.
- Add admin UI for library creation/editing.
- Add library filtering to frontend.
- Add scan jobs per library.

---

# 7. User Profiles and Household Features

## Objective

Support family use and multi-user progress separation.

## Features

- User accounts
- Profile avatars
- Kids profiles
- Library restrictions
- Per-user progress
- Per-user favorites
- Per-user bookmarks
- Per-user listening history
- Admin/user roles

## Coding Agent Tasks

- Expand auth/user model if needed.
- Add profile model if user account and listening profile should be separate.
- Add profile switching UI.
- Add role-based API restrictions.
- Add parental/kids library filtering.

---

# 8. 3D Virtual Bookshelf View

## Objective

Create an optional immersive GUI mode where audiobooks appear as 3D book spines on shelves.

This should not replace the standard grid/list. It should be an alternate view.

## Suggested Stack

```bash
npm install three @react-three/fiber @react-three/drei framer-motion zustand
```

## Feature Structure

```text
client/src/features/bookshelf3d/
  BookshelfScene.tsx
  Shelf.tsx
  BookSpine.tsx
  SelectedBookPanel.tsx
  bookshelfStore.ts
  bookshelfLayout.ts
  types.ts
```

## Interaction Flow

```text
Load books from API
    ↓
Convert books into shelf positions
    ↓
Render books as 3D spine objects
    ↓
User clicks book spine
    ↓
Book animates outward from shelf
    ↓
Camera eases toward selected book
    ↓
Metadata panel slides in
    ↓
User can Play, Download, Edit, Favorite, or Close
```

## MVP Behavior

- Render first 50-100 books.
- Use simple box geometry for books.
- Add title/author text on spine.
- Click spine to select.
- Animate selected book outward.
- Show normal React metadata panel.
- Use existing player actions for Play button.

## Performance Rules

- Do not load all covers as 3D textures initially.
- Use simple box geometry.
- Virtualize shelves for large libraries.
- Add a reduced-motion setting.
- Keep normal grid/list view available.
- Disable or simplify 3D view on weak mobile devices.

## Coding Agent Tasks

- Add `BookshelfView` route or view toggle.
- Add Three.js canvas scene.
- Add layout algorithm for shelf positions.
- Add clickable book spines.
- Add pull-out animation.
- Add selected book side panel.
- Connect Play/Download/Edit buttons to existing book actions.

---

# 9. Immersive Listening Features

## Objective

Support the product identity of a cozy, tactile audiobook environment.

## Features

- Ambient mode
- Reading room mode
- Currently playing book glow in 3D shelf
- Animated background scene
- Theme presets
- Fireplace/rain/library ambience toggle
- Large-screen living room mode

## Example Themes

```text
Classic Library
Fantasy Archive
Sci-Fi Vault
Cozy Cabin
Cyberpunk Shelf
Minimal Modern
```

## Coding Agent Tasks

- Add theme config system.
- Add frontend theme selector.
- Add optional ambient audio controls.
- Add currently-playing visual state.
- Add large-display mode.

---

# 10. Recommendation and Discovery System

## Objective

Help users decide what to listen to next.

## Features

- Continue listening
- Continue series
- Recently added
- Recommended by narrator
- Recommended by author
- Recommended by genre
- Unfinished books
- Forgotten books
- Short listens
- Long listens
- Finished series
- Abandoned books

## Signals to Track

```text
listening duration
completion percentage
favorites
ratings
narrator preference
genre preference
time-of-day listening
series completion
manual skips/abandons
```

## Coding Agent Tasks

- Add event tracking for listening behavior.
- Add recommendation service.
- Add frontend recommendation shelves.
- Add explainable labels like “Because you listened to...”

---

# 11. Offline Sync System

## Objective

Let users download audiobooks or chapters for offline use.

## Features

- Download full book
- Download selected chapters
- Download next X hours
- Storage quota per user/device
- Offline progress sync
- Transcoded mobile-friendly versions
- Expiring downloads

## Coding Agent Tasks

- Add download API.
- Add download preparation job.
- Add progress tracking for downloads.
- Add client-side offline cache strategy.
- Add PWA support for offline playback if feasible.

---

# 12. Audio Processing Pipeline

## Objective

Improve audio quality and streaming performance.

## Features

- Loudness normalization
- Silence trimming
- Bitrate optimization
- Format conversion
- Waveform generation
- Chapter boundary cleanup
- Streamable proxy/transcode output

## Suggested Tech

- FFmpeg
- Background workers
- Job queue
- Persistent processing status

## Coding Agent Tasks

- Add audio processing job model.
- Add FFmpeg wrapper service.
- Add admin processing queue UI.
- Add per-book processing status.
- Add safe failure handling.

---

# 13. AI-Powered Features

## Objective

Use AI carefully to improve discovery and metadata quality without making the core app dependent on AI.

## Features

- Smart natural-language search
- Spoiler-free summaries
- Tone/mood tags
- Metadata cleanup suggestions
- Semantic chapter naming
- Duplicate detection assistance
- “Find me something like...” search

## Example Queries

```text
Find a fantasy book with dragons and political intrigue.
Show me short books narrated by someone similar to Ray Porter.
Find unfinished sci-fi books under 10 hours.
```

## Coding Agent Tasks

- Add optional AI provider settings.
- Add AI task queue.
- Add local/offline fallback behavior.
- Add review-before-apply workflow for AI metadata changes.
- Store AI-generated fields separately from verified metadata.

---

# 14. Plugin and Connector Architecture

## Objective

Keep optional integrations isolated from the core server.

## Possible Connectors

- Audible
- Google Books
- Open Library
- Audiobookshelf import
- Plex/Jellyfin import
- Local metadata files
- OPF/NFO files
- Calibre libraries

## Suggested Architecture

```text
Core Server
  ├── Scanner Service
  ├── Metadata Service
  ├── Audio Processing Service
  ├── Playback Service
  ├── File Manager Service
  └── Connector Plugins
```

## Coding Agent Tasks

- Define connector interface.
- Add connector registry.
- Add enable/disable connector settings.
- Add isolated connector configuration.
- Add metadata source priority order.

---

# 15. Admin Dashboard Improvements

## Objective

Give admins a clear view of server health and content quality.

## Dashboard Sections

- Library scan status
- Failed scans
- Missing metadata
- Missing covers
- Duplicate books
- Broken file paths
- Processing jobs
- Storage usage
- User activity
- Recently added books

## Coding Agent Tasks

- Add admin overview route.
- Add status cards.
- Add actionable queues.
- Add filters for metadata problems.
- Add server health endpoint.

---

# Suggested Development Phases

## Phase 1: Core Reliability

- Scanner service
- Incremental scans
- Metadata schema expansion
- Server-side progress sync
- Admin scan dashboard

## Phase 2: Collection Management

- Multi-library support
- File/folder manager
- Bulk rename dry-run
- Metadata review queue
- Duplicate detection

## Phase 3: Listening Experience

- Sleep timer
- Bookmarks
- Chapter navigation
- Recommendation shelves
- Improved player persistence

## Phase 4: Visual Identity

- 3D bookshelf MVP
- Pull-out book animation
- Metadata side panel
- Immersive themes
- Reduced-motion fallback

## Phase 5: Advanced Platform

- Offline sync
- Audio processing pipeline
- AI metadata tools
- Plugin/connector architecture
- Mobile/native app planning

---

# Non-Negotiable Engineering Rules

1. Keep standard grid/list views available.
2. Do not make the 3D interface required for usability.
3. Keep destructive file operations admin-only.
4. Always validate filesystem paths against configured library roots.
5. Use background jobs for scans, metadata matching, and audio processing.
6. Track progress and errors for every long-running job.
7. Store user listening progress server-side.
8. Avoid loading every cover or 3D object at once.
9. Keep AI-generated metadata reviewable before applying.
10. Design everything around large libraries from the start.

---

# Immediate Next Task Recommendation

Start with the scanner and metadata foundation.

Recommended first coding task:

> Add a background library scanner service with scan jobs, indexed file records, websocket scan progress events, and an admin scan dashboard.

This unlocks nearly every future feature: metadata matching, file management, duplicate detection, recommendations, and 3D shelf browsing.

