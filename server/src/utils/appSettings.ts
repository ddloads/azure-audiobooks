import prisma from "../lib/prisma";

const APPEARANCE_SETTINGS_KEY = "appearance";

export interface AppearanceSettings {
  showReviewBooks: boolean;
  shelfContinueListening: boolean;
  shelfNextInSeries: boolean;
  shelfYouMightLike: boolean;
  shelfRecentlyAdded: boolean;
}

const defaultAppearanceSettings = (): AppearanceSettings => ({
  showReviewBooks: true,
  shelfContinueListening: true,
  shelfNextInSeries: true,
  shelfYouMightLike: true,
  shelfRecentlyAdded: true,
});

const parseAppearanceSettings = (value: string | null | undefined): AppearanceSettings => {
  const defaults = defaultAppearanceSettings();
  if (!value) return defaults;

  try {
    const parsed = JSON.parse(value) as Partial<AppearanceSettings>;
    return {
      showReviewBooks:          parsed.showReviewBooks          ?? defaults.showReviewBooks,
      shelfContinueListening:   parsed.shelfContinueListening   ?? defaults.shelfContinueListening,
      shelfNextInSeries:        parsed.shelfNextInSeries        ?? defaults.shelfNextInSeries,
      shelfYouMightLike:        parsed.shelfYouMightLike        ?? defaults.shelfYouMightLike,
      shelfRecentlyAdded:       parsed.shelfRecentlyAdded       ?? defaults.shelfRecentlyAdded,
    };
  } catch {
    return defaults;
  }
};

export const getAppearanceSettings = async (): Promise<AppearanceSettings> => {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${APPEARANCE_SETTINGS_KEY} LIMIT 1
  `;

  return parseAppearanceSettings(rows[0]?.value);
};

export const updateAppearanceSettings = async (
  settings: Partial<AppearanceSettings>,
): Promise<AppearanceSettings> => {
  const current = await getAppearanceSettings();
  const defaults = defaultAppearanceSettings();
  const next = { ...current };

  for (const k of Object.keys(defaults) as (keyof AppearanceSettings)[]) {
    if (typeof settings[k] === "boolean") {
      next[k] = settings[k] as boolean;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${APPEARANCE_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  return next;
};

/* ── Scan processing ──────────────────────────────────────────────────────
   Admin switches for the expensive per-file work a scan does. The old env
   variables only set the default until an admin flips a switch. */

const SCAN_SETTINGS_KEY = "scan";
// Scans run in worker threads with their own module state, so each thread
// caches for a few seconds instead of hitting the database per file.
const SCAN_SETTINGS_CACHE_MS = 10_000;

export interface ScanSettings {
  /** Remux .m4b/.m4a/.mp4 files so the index sits at the front (faster seeking when streaming). */
  fastStartEnabled: boolean;
  /** Decode single-file books without embedded chapters to place chapters at pauses. */
  silenceChapters: boolean;
}

const defaultScanSettings = (): ScanSettings => ({
  fastStartEnabled: process.env.FAST_START_ENABLED !== "false",
  silenceChapters: process.env.AUTO_CHAPTERIZE_SILENCE !== "0",
});

const parseScanSettings = (value: string | null | undefined): ScanSettings => {
  const defaults = defaultScanSettings();
  if (!value) return defaults;

  try {
    const parsed = JSON.parse(value) as Partial<ScanSettings>;
    return {
      fastStartEnabled: typeof parsed.fastStartEnabled === "boolean" ? parsed.fastStartEnabled : defaults.fastStartEnabled,
      silenceChapters:  typeof parsed.silenceChapters === "boolean"  ? parsed.silenceChapters  : defaults.silenceChapters,
    };
  } catch {
    return defaults;
  }
};

let scanSettingsCache: { at: number; settings: ScanSettings } | null = null;

export const getScanSettings = async (): Promise<ScanSettings> => {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${SCAN_SETTINGS_KEY} LIMIT 1
  `;

  const settings = parseScanSettings(rows[0]?.value);
  scanSettingsCache = { at: Date.now(), settings };
  return settings;
};

/** Cached read for hot paths (per file during scans). Falls back to the defaults if the database is unreachable. */
export const getScanSettingsCached = async (): Promise<ScanSettings> => {
  if (scanSettingsCache && Date.now() - scanSettingsCache.at < SCAN_SETTINGS_CACHE_MS) {
    return scanSettingsCache.settings;
  }
  return getScanSettings().catch(() => scanSettingsCache?.settings ?? defaultScanSettings());
};

export const updateScanSettings = async (settings: Partial<ScanSettings>): Promise<ScanSettings> => {
  const next = { ...(await getScanSettings()) };

  for (const k of Object.keys(defaultScanSettings()) as (keyof ScanSettings)[]) {
    if (typeof settings[k] === "boolean") {
      next[k] = settings[k] as boolean;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${SCAN_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  scanSettingsCache = { at: Date.now(), settings: next };
  return next;
};
