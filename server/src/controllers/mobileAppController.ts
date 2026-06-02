import { Request, Response } from "express";
import path from "path";
import fsp from "fs/promises";

const MOBILE_APP_DIR = path.join(process.cwd(), "data", "mobile");
const APK_PATH = path.join(MOBILE_APP_DIR, "azure-player-latest.apk");
const MANIFEST_PATH = path.join(MOBILE_APP_DIR, "azure-player-latest.json");

type MobileAppManifest = {
  appName: string;
  version: string;
  fileName: string;
  size: number;
  updatedAt: string;
  sourcePath?: string;
};

const readManifest = async (): Promise<MobileAppManifest | null> => {
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as MobileAppManifest;
  } catch {
    return null;
  }
};

export const getLatestMobileApp = async (_req: Request, res: Response) => {
  const manifest = await readManifest();
  if (!manifest) {
    res.status(404).json({ error: "No Azure Player APK has been published yet" });
    return;
  }

  res.json({
    ...manifest,
    downloadUrl: "/api/mobile-app/latest.apk",
  });
};

export const downloadLatestMobileApp = async (_req: Request, res: Response) => {
  const manifest = await readManifest();
  if (!manifest) {
    res.status(404).json({ error: "No Azure Player APK has been published yet" });
    return;
  }

  try {
    await fsp.access(APK_PATH);
  } catch {
    res.status(404).json({ error: "Published Azure Player APK is missing" });
    return;
  }

  res.download(APK_PATH, manifest.fileName || "AzurePlayer-latest.apk");
};
