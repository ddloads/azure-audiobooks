import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import prisma from "../../lib/prisma";
import { listAudibleCliProfiles, resolveAudibleProfile } from "../../utils/audibleCli";
import {
  isAudibleLibrarySyncing,
  listAudibleLibrary,
  setAudibleTitlesIgnored,
  syncAudibleLibrary,
} from "../../utils/audibleLibrary";
import { enqueueAudibleDownloads } from "../../utils/audibleDownloader";
import { getAudibleAutoSyncStatus, queueNewAudiblePurchases } from "../../utils/audibleAutoSync";
import { getAudibleSyncSettings, updateAudibleSyncSettings } from "../../utils/appSettings";
import { getSingleBodyValue } from "./shared";

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

const getQueryProfile = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getAsins = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((asin): asin is string => typeof asin === "string").map((asin) => asin.trim().toUpperCase())))
        .filter((asin) => ASIN_PATTERN.test(asin))
    : [];

/** The linked account's Audible titles, each marked with whether it's already in the library. */
export const getAudibleLibraryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [result, libraries, settings] = await Promise.all([
      listAudibleLibrary(getQueryProfile(req.query.profile)),
      prisma.library.findMany({
        where: { isActive: true, sources: { some: { isEnabled: true, isWritable: true } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      getAudibleSyncSettings(),
    ]);
    res.json({
      ...result,
      profiles: listAudibleCliProfiles().map((profile) => profile.name),
      syncing: isAudibleLibrarySyncing(),
      libraries,
      settings,
      autoSync: getAudibleAutoSyncStatus(),
    });
  } catch (error) {
    console.error("List Audible library error:", error);
    res.status(500).json({ error: "Failed to load Audible titles" });
  }
};

export const syncAudibleLibraryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await syncAudibleLibrary(getSingleBodyValue(req.body?.profile));
    const queued = await queueNewAudiblePurchases(result.profile).catch(() => 0);
    res.json({ ...result, queued });
  } catch (error) {
    console.error("Sync Audible library error:", error);
    const message = error instanceof Error ? error.message : "Failed to sync Audible library";
    res.status(502).json({ error: `Couldn't read the Audible library: ${message}` });
  }
};

export const setAudibleTitlesIgnoredHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profile = resolveAudibleProfile(getSingleBodyValue(req.body?.profile));
    const asins = getAsins(req.body?.asins);
    if (!profile || !asins.length || typeof req.body?.ignored !== "boolean") {
      res.status(400).json({ error: "profile, asins and ignored are required" });
      return;
    }
    const updated = await setAudibleTitlesIgnored(profile, asins, req.body.ignored);
    res.json({ updated });
  } catch (error) {
    console.error("Ignore Audible titles error:", error);
    res.status(500).json({ error: "Failed to update titles" });
  }
};

export const downloadAudibleTitlesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const profile = resolveAudibleProfile(getSingleBodyValue(req.body?.profile));
    const asins = getAsins(req.body?.asins);
    const libraryId = getSingleBodyValue(req.body?.libraryId);
    if (!profile || !asins.length || !libraryId) {
      res.status(400).json({ error: "profile, asins and libraryId are required" });
      return;
    }
    const queued = await enqueueAudibleDownloads(profile, asins, libraryId);
    res.status(202).json({ queued });
  } catch (error) {
    console.error("Download Audible titles error:", error);
    const message = error instanceof Error ? error.message : "Failed to queue downloads";
    res.status(400).json({ error: message });
  }
};

export const updateAudibleSyncSettingsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const libraryId = typeof body.libraryId === "string" ? body.libraryId : body.libraryId === null ? null : undefined;
    if (libraryId) {
      const writable = await prisma.librarySource.findFirst({ where: { libraryId, isEnabled: true, isWritable: true } });
      if (!writable) {
        res.status(400).json({ error: "That library has no writable folder." });
        return;
      }
    }
    const settings = await updateAudibleSyncSettings({
      autoSync: typeof body.autoSync === "boolean" ? body.autoSync : undefined,
      intervalMinutes: typeof body.intervalMinutes === "number" ? body.intervalMinutes : undefined,
      autoDownload: typeof body.autoDownload === "boolean" ? body.autoDownload : undefined,
      libraryId,
    });
    res.json({ settings, autoSync: getAudibleAutoSyncStatus() });
  } catch (error) {
    console.error("Update Audible sync settings error:", error);
    res.status(500).json({ error: "Failed to save settings" });
  }
};
