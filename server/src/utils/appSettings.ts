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
  /** Look up Audible's chapters by ASIN (via Audnexus) for books without embedded chapters. */
  audibleChapters: boolean;
}

const defaultScanSettings = (): ScanSettings => ({
  fastStartEnabled: process.env.FAST_START_ENABLED !== "false",
  silenceChapters: process.env.AUTO_CHAPTERIZE_SILENCE !== "0",
  audibleChapters: true,
});

const parseScanSettings = (value: string | null | undefined): ScanSettings => {
  const defaults = defaultScanSettings();
  if (!value) return defaults;

  try {
    const parsed = JSON.parse(value) as Partial<ScanSettings>;
    return {
      fastStartEnabled: typeof parsed.fastStartEnabled === "boolean" ? parsed.fastStartEnabled : defaults.fastStartEnabled,
      silenceChapters:  typeof parsed.silenceChapters === "boolean"  ? parsed.silenceChapters  : defaults.silenceChapters,
      audibleChapters:  typeof parsed.audibleChapters === "boolean"  ? parsed.audibleChapters  : defaults.audibleChapters,
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

/* ── Registration ─────────────────────────────────────────────────────────
   Whether anyone may create an account. Invites and the very first account
   (which becomes the admin) always work. */

const REGISTRATION_SETTINGS_KEY = "registration";

export interface RegistrationSettings {
  openRegistration: boolean;
}

export const getRegistrationSettings = async (): Promise<RegistrationSettings> => {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${REGISTRATION_SETTINGS_KEY} LIMIT 1
  `;

  try {
    const parsed = rows[0] ? (JSON.parse(rows[0].value) as Partial<RegistrationSettings>) : {};
    return { openRegistration: typeof parsed.openRegistration === "boolean" ? parsed.openRegistration : true };
  } catch {
    return { openRegistration: true };
  }
};

export const updateRegistrationSettings = async (
  settings: Partial<RegistrationSettings>,
): Promise<RegistrationSettings> => {
  const next = { ...(await getRegistrationSettings()) };
  if (typeof settings.openRegistration === "boolean") next.openRegistration = settings.openRegistration;

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${REGISTRATION_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  return next;
};

/* ── Audible sync ─────────────────────────────────────────────────────────
   Background sync of every linked Audible account, and whether titles bought
   after auto-download was turned on are downloaded without asking. */

const AUDIBLE_SYNC_SETTINGS_KEY = "audibleSync";
export const AUDIBLE_SYNC_INTERVALS = [15, 30, 60, 180, 360, 720, 1440];
export const MAX_PARALLEL_AUDIBLE_DOWNLOADS = 5;

export interface AudibleSyncSettings {
  autoSync: boolean;
  intervalMinutes: number;
  autoDownload: boolean;
  /** Library that downloads go into, manual or automatic. */
  libraryId: string | null;
  /** When auto-download was last turned on; only titles purchased after it download on their own. */
  autoDownloadSince: string | null;
  /** How many titles download at the same time. */
  maxConcurrentDownloads: number;
}

const isConcurrencyValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PARALLEL_AUDIBLE_DOWNLOADS;

const defaultAudibleSyncSettings = (): AudibleSyncSettings => ({
  autoSync: false,
  intervalMinutes: 30,
  autoDownload: false,
  libraryId: null,
  autoDownloadSince: null,
  maxConcurrentDownloads: 2,
});

export const getAudibleSyncSettings = async (): Promise<AudibleSyncSettings> => {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${AUDIBLE_SYNC_SETTINGS_KEY} LIMIT 1
  `;
  const defaults = defaultAudibleSyncSettings();
  try {
    const parsed = rows[0] ? (JSON.parse(rows[0].value) as Partial<AudibleSyncSettings>) : {};
    return {
      autoSync: typeof parsed.autoSync === "boolean" ? parsed.autoSync : defaults.autoSync,
      intervalMinutes: AUDIBLE_SYNC_INTERVALS.includes(parsed.intervalMinutes ?? -1) ? parsed.intervalMinutes! : defaults.intervalMinutes,
      autoDownload: typeof parsed.autoDownload === "boolean" ? parsed.autoDownload : defaults.autoDownload,
      libraryId: typeof parsed.libraryId === "string" ? parsed.libraryId : defaults.libraryId,
      autoDownloadSince: typeof parsed.autoDownloadSince === "string" ? parsed.autoDownloadSince : defaults.autoDownloadSince,
      maxConcurrentDownloads: isConcurrencyValue(parsed.maxConcurrentDownloads) ? parsed.maxConcurrentDownloads : defaults.maxConcurrentDownloads,
    };
  } catch {
    return defaults;
  }
};

export const updateAudibleSyncSettings = async (
  settings: Partial<Omit<AudibleSyncSettings, "autoDownloadSince">>,
): Promise<AudibleSyncSettings> => {
  const current = await getAudibleSyncSettings();
  const next = { ...current };
  if (typeof settings.autoSync === "boolean") next.autoSync = settings.autoSync;
  if (typeof settings.intervalMinutes === "number" && AUDIBLE_SYNC_INTERVALS.includes(settings.intervalMinutes)) {
    next.intervalMinutes = settings.intervalMinutes;
  }
  if (typeof settings.autoDownload === "boolean") next.autoDownload = settings.autoDownload;
  if (isConcurrencyValue(settings.maxConcurrentDownloads)) next.maxConcurrentDownloads = settings.maxConcurrentDownloads;
  if (typeof settings.libraryId === "string" || settings.libraryId === null) next.libraryId = settings.libraryId;
  // Turning auto-download on doesn't reach back into the existing backlog.
  if (next.autoDownload && !current.autoDownload) next.autoDownloadSince = new Date().toISOString();

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${AUDIBLE_SYNC_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  return next;
};
