import { createLogger } from "../lib/logger";
import { getAudibleSyncSettings } from "./appSettings";
import { listAudibleCliProfiles } from "./audibleCli";
import { isAudibleLibrarySyncing, listAudibleLibrary, syncAudibleLibrary } from "./audibleLibrary";
import { enqueueAudibleDownloads } from "./audibleDownloader";

// Syncs every linked Audible account on the interval set on the Missing page,
// and queues titles bought since auto-download was turned on.

const logger = createLogger("audible-auto-sync");
const TICK_MS = 60_000;

export interface AudibleAutoSyncStatus {
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
}

let timer: NodeJS.Timeout | null = null;
let status: AudibleAutoSyncStatus = { running: false, lastRunAt: null, nextRunAt: null, lastError: null };

export const getAudibleAutoSyncStatus = (): AudibleAutoSyncStatus => ({ ...status });

/**
 * Queues the profile's new purchases when auto-download is on: titles bought
 * after it was turned on that aren't in the library, ignored or tried before.
 */
export const queueNewAudiblePurchases = async (profile: string) => {
  const settings = await getAudibleSyncSettings();
  if (!settings.autoDownload || !settings.libraryId || !settings.autoDownloadSince) return 0;

  const since = new Date(settings.autoDownloadSince);
  const { items } = await listAudibleLibrary(profile);
  const asins = items
    .filter((item) => !item.bookId && !item.ignored && !item.downloadStatus && item.purchaseDate && new Date(item.purchaseDate) >= since)
    .map((item) => item.asin);
  if (!asins.length) return 0;

  const queued = await enqueueAudibleDownloads(profile, asins, settings.libraryId);
  logger.info("Queued new Audible purchases", { profile, queued });
  return queued;
};

const runOnce = async () => {
  status.running = true;
  const errors: string[] = [];
  try {
    for (const { name } of listAudibleCliProfiles()) {
      if (isAudibleLibrarySyncing()) continue;
      try {
        await syncAudibleLibrary(name);
        await queueNewAudiblePurchases(name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${name}: ${message}`);
        logger.warn("Audible auto-sync failed", { profile: name, error: message });
      }
    }
  } finally {
    status.running = false;
    status.lastRunAt = new Date().toISOString();
    status.lastError = errors.length ? errors.join(" · ").slice(0, 500) : null;
  }
};

const tick = async () => {
  if (status.running) return;
  try {
    const settings = await getAudibleSyncSettings();
    if (!settings.autoSync) {
      status.nextRunAt = null;
      return;
    }
    const intervalMs = settings.intervalMinutes * 60_000;
    const due = status.lastRunAt ? new Date(status.lastRunAt).getTime() + intervalMs : Date.now();
    status.nextRunAt = new Date(due).toISOString();
    if (Date.now() < due) return;
    await runOnce();
    status.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  } catch (error) {
    logger.warn("Audible auto-sync tick failed", { error: String(error) });
  }
};

export const startAudibleAutoSync = () => {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
};

export const stopAudibleAutoSync = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
