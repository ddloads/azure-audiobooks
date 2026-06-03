import { Request, Response } from "express";
import path from "path";
import fsp from "fs/promises";

const MOBILE_APP_DIR = path.join(process.cwd(), "data", "mobile");
const APK_FILENAME = "azure-player-latest.apk";
const MANIFEST_FILENAME = "azure-player-latest.json";

const VERSION_REGEX = /v?(\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)?)/;

type MobileAppManifest = {
  appName: string;
  version: string;
  fileName: string;
  size: number;
  updatedAt: string;
};

const parseVersionFromName = (name: string): string | null => {
  const match = name.match(VERSION_REGEX);
  return match ? match[1] : null;
};

const readManifest = async (): Promise<MobileAppManifest | null> => {
  try {
    const raw = await fsp.readFile(path.join(MOBILE_APP_DIR, MANIFEST_FILENAME), "utf8");
    return JSON.parse(raw) as MobileAppManifest;
  } catch {
    return null;
  }
};

const findPublishedApkPath = async () => {
  const apkPath = path.join(MOBILE_APP_DIR, APK_FILENAME);
  try {
    await fsp.access(apkPath);
    return apkPath;
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

  // The latest manifest is mutable because publishing a new APK updates this URL.
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
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

  // Keep repeat downloads reasonably cacheable without making the stable latest.apk URL sticky for long.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.download(apkPath, manifest.fileName || "AzurePlayer-latest.apk");
};

export const publishMobileApp = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No APK file uploaded" });
    return;
  }

  const cleanupTemp = async () => {
    if (file.path) {
      await fsp.unlink(file.path).catch(() => undefined);
    }
  };

  try {
    await fsp.mkdir(MOBILE_APP_DIR, { recursive: true });
    const targetApk = path.join(MOBILE_APP_DIR, APK_FILENAME);
    const targetManifest = path.join(MOBILE_APP_DIR, MANIFEST_FILENAME);

    try {
      await fsp.rename(file.path, targetApk);
    } catch {
      await fsp.copyFile(file.path, targetApk);
      await cleanupTemp();
    }

    const requestedVersion =
      typeof req.body?.version === "string" ? req.body.version.trim() : "";
    const version =
      requestedVersion || parseVersionFromName(file.originalname) || "unknown";

    const stat = await fsp.stat(targetApk);
    const manifest: MobileAppManifest = {
      appName: "Azure Player",
      version,
      fileName: file.originalname,
      size: stat.size,
      updatedAt: new Date().toISOString(),
    };

    await fsp.writeFile(
      targetManifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    res.json({ ...manifest, downloadUrl: "/api/mobile-app/latest.apk" });
  } catch (error) {
    await cleanupTemp();
    console.error("Failed to publish Azure Player APK", error);
    res.status(500).json({ error: "Failed to publish APK" });
  }
};
