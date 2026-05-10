# Migration Plan: Audible Scraping → audible-cli

## What you gain

Current scraping parses HTML — Audible changes their page layout regularly and it breaks silently. audible-cli uses the **official Audible API** (the same one their mobile app uses), returning structured JSON with reliable fields for title, author, narrator, series, genres, language, publisher, ASIN, cover URL, and runtime. Genre and language will be accurate every time.

---

## Architecture decision: optional with fallback

audible-cli requires Python and an Audible account auth. Make it **opt-in**: if it's set up and authenticated, use it; otherwise fall back to the current scraper. This keeps the app functional out of the box.

---

## Phase 1 — Server utility (`audibleCli.ts`)

**New file: `server/src/utils/audibleCli.ts`**

Responsible for shelling out to the `audible` CLI:

```
audible api /1.0/catalog/products/{asin}?
  response_groups=product_desc,contributors,series,rating,
  category_ladders,product_attrs,relationships

audible api /1.0/catalog/products?
  title={title}&author={author}&
  response_groups=product_desc,contributors,series,category_ladders,product_attrs
```

Key functions to implement:

- `isAudibleCliAvailable(): Promise<boolean>` — runs `audible --version` and checks for a configured profile
- `getAudibleCliStatus(): Promise<{ installed: boolean; profileCount: number; profiles: string[] }>` — used by the admin UI
- `searchAudibleCli(query, author?, asin?): Promise<AudibleMatchCandidate[]>` — queries the API, maps the JSON response to the existing `AudibleMatchCandidate` shape so the rest of the code needs no changes

### Response mapping (Audible API → `AudibleMetadata`)

| API field | Maps to |
|---|---|
| `product.title` | `title` |
| `product.subtitle` | `subtitle` |
| `product.authors[].name` | `author` (comma-joined) |
| `product.narrators[].name` | `narrator` |
| `product.series[0].title` | `seriesName` |
| `product.series[0].sequence` | `seriesSequence` |
| `product.publisher_summary` | `description` |
| `product.publisher_name` | `publisher` |
| `product.release_date` | `year` |
| `product.category_ladders[0].ladder[*].name` | `genres` |
| `product.language` | `language` |
| `product.asin` | `asin` |
| `product.runtime_length_min * 60` | `durationSeconds` |
| `product.product_images.500` | `imageUrl` |

---

## Phase 2 — Auth flow (server-side)

audible-cli's auth is a multi-step OAuth flow. The user visits an Amazon URL, logs in, and gets redirected to a `localhost` callback. The CLI captures this.

**New endpoints in `adminController.ts` (or a new `audibleAuthController.ts`):**

```
GET  /admin/audible-cli/status        → { installed, authenticated, profiles }
POST /admin/audible-cli/auth/start    → launches auth flow, returns Amazon login URL
POST /admin/audible-cli/auth/complete → user confirms, saves profile
DELETE /admin/audible-cli/auth        → removes the stored profile
```

The tricky part: audible-cli's `quickstart` command is interactive. The cleanest approach is to run `audible manage auth-file add` non-interactively and capture the auth URL from its stdout, then let the user complete it in their browser.

**Alternative (simpler):** Expose a terminal-style instruction in the admin UI: "Run this command in your server terminal, then click Verify." This avoids the complexity of trying to drive an interactive CLI from the app.

---

## Phase 3 — Hook into `searchBookMatches`

Modify `adminController.ts::searchBookMatches`:

```ts
if (provider === "audible" || provider === "combined") {
  const cliAvailable = await isAudibleCliAvailable();
  if (cliAvailable) {
    candidates = await searchAudibleCli(query, author, book.asin);
  } else {
    candidates = await searchAudible(query, { ... }, author);  // existing scraper
  }
}
```

No client changes needed — same response shape.

---

## Phase 4 — Admin UI (`AdminSettingsModal.tsx`)

Add a new card in the **System** tab:

```
┌─ Audible CLI Integration ──────────────────┐
│  Status:  ✓ Installed  ✗ Not authenticated │
│                                            │
│  [Setup Instructions]  [Verify]  [Remove]  │
└────────────────────────────────────────────┘
```

- **Setup Instructions** (shown when not authenticated): displays the two commands the admin should run in a terminal (`pip install audible-cli` + `audible quickstart`)
- **Verify** button: hits the `/admin/audible-cli/status` endpoint and refreshes the status badge
- **Remove** button: deletes the audible-cli profile config (not the Python package)

New endpoint needed: `GET /admin/audible-cli/status` returns installed/authenticated state.

---

## Phase 5 — Marketplace config

The Audible API is locale-specific (audible.com, audible.co.uk, etc.). Add an optional env var:

```
AUDIBLE_MARKETPLACE=us   # us, uk, de, fr, au, ca, jp, it, in, es
```

Pass `--marketplace` to audible-cli commands, default to `us`.

---

## Files to create/modify

| File | Change |
|---|---|
| `server/src/utils/audibleCli.ts` | **New** — CLI wrapper + response mapper |
| `server/src/controllers/adminController.ts` | Add `getAudibleCliStatus`, modify `searchBookMatches` to prefer CLI |
| `server/src/routes/adminRoutes.ts` | Add `GET /audible-cli/status` |
| `client/src/components/AdminSettingsModal.tsx` | Add Audible CLI status card to System tab |
| `client/src/styles/globals.css` | Minor styles for new card if needed |

The existing `audible.ts` scraper stays untouched as the fallback — no code is deleted.

---

## Risks and open questions

1. **Windows PATH**: `audible` needs to be in PATH when the Node server starts. On Windows with pip, it often isn't automatically. The status check should give a clear error and tell the admin where to look.

2. **Auth flow complexity**: The interactive `quickstart` is hard to drive programmatically. The simplest safe approach is to show the terminal commands in the UI rather than trying to automate auth from the server.

3. **Rate limits**: The Audible API is unauthenticated-rate-limited but authenticated requests are generous. No specific throttling needed beyond what's already in the scraper.

4. **Audible account requirement**: The admin must have an Audible account (free account works — no purchases needed). Worth documenting in the setup UI.

---

## Recommended order of work

1. `audibleCli.ts` + `searchAudibleCli()` (can be tested independently with a manual `audible` install)
2. `getAudibleCliStatus()` + the status endpoint
3. Hook into `searchBookMatches` with the fallback logic
4. Admin UI status card
5. Auth instructions UI
6. Marketplace env var
