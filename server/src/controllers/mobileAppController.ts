import { Request, Response } from "express";
import path from "path";
import fsp from "fs/promises";

const MOBILE_APP_DIRS = [
  path.join(process.cwd(), "data", "mobile"),
  path.join(process.cwd(), "public", "mobile"),
];
const APK_FILENAME = "azure-player-latest.apk";
const MANIFEST_FILENAME = "azure-player-latest.json";

type MobileAppManifest = {
  appName: string;
  version: string;
  fileName: string;
  size: number;
  updatedAt: string;
};

const readManifest = async (): Promise<MobileAppManifest | null> => {
  for (const dir of MOBILE_APP_DIRS) {
    try {
      const raw = await fsp.readFile(path.join(dir, MANIFEST_FILENAME), "utf8");
      return JSON.parse(raw) as MobileAppManifest;
    } catch {
      // Try the next configured publish location.
    }
  }

  return null;
};

const findPublishedApkPath = async () => {
  for (const dir of MOBILE_APP_DIRS) {
    const apkPath = path.join(dir, APK_FILENAME);
    try {
      await fsp.access(apkPath);
      return apkPath;
    } catch {
      // Try the next configured publish location.
    }
  }

  return null;
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

  const apkPath = await findPublishedApkPath();
  if (!apkPath) {
    res.status(404).json({ error: "Published Azure Player APK is missing" });
    return;
  }

  res.download(apkPath, manifest.fileName || "AzurePlayer-latest.apk");
};
