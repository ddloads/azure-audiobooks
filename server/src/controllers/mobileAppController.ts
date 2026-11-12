import { Request, Response } from "express";
import path from "path";
import fsp from "fs/promises";
import { createReadStream } from "fs";
import { createHash, randomUUID } from "crypto";

const MOBILE_APP_DIR = path.join(process.cwd(), "data", "mobile");
const MANIFEST_FILENAME = "azure-player-latest.json";

type MobileAppManifest = {
  appName: string;
  version: string;
  versionCode: number | null;
  fileName: string;
  size: number;
  updatedAt: string;
  sha256?: string;
  storageFile?: string;
};

const readManifest = async (): Promise<MobileAppManifest | null> => {
  try {
    return JSON.parse(await fsp.readFile(path.join(MOBILE_APP_DIR, MANIFEST_FILENAME), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error; // Corrupt metadata must never permit a downgrade.
  }
};
const apkPath = (manifest: MobileAppManifest) => path.join(
  MOBILE_APP_DIR, manifest.storageFile || "azure-player-latest.apk",
);
const hashFile = async (file: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
const responseManifest = (manifest: MobileAppManifest) => ({
  ...manifest,
  storageFile: undefined,
  versionCode: manifest.versionCode ?? null,
  downloadUrl: `/api/mobile-app/latest.apk?build=${manifest.versionCode ?? 0}`,
});
const noCache = (res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
};

export const getLatestMobileApp = async (_req: Request, res: Response) => {
  noCache(res);
  const manifest = await readManifest();
  if (!manifest) {
    res.status(404).json({ error: "No Azure Player APK has been published yet" });
    return;
  }
  await fsp.access(apkPath(manifest));
  res.json(responseManifest(manifest));
};

export const downloadLatestMobileApp = async (req: Request, res: Response) => {
  noCache(res);
  const manifest = await readManifest();
  if (!manifest) {
    res.status(404).json({ error: "No Azure Player APK has been published yet" });
    return;
  }
  // Clients may append build twice; accept only identical, current values.
  const requested = req.query.build;
  const builds = Array.isArray(requested) ? requested : [requested];
  if (requested !== undefined && builds.some(value => String(value) !== String(manifest.versionCode ?? 0))) {
    res.status(409).json({ error: "The published build changed; check for updates again" });
    return;
  }
  res.download(apkPath(manifest), manifest.fileName, { cacheControl: false, lastModified: false });
};

export const publishMobileApp = async (req: Request, res: Response) => {
  noCache(res);
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No APK file uploaded" });
    return;
  }
  const lockPath = path.join(MOBILE_APP_DIR, ".publish-lock");
  const manifestTemp = path.join(MOBILE_APP_DIR, `${randomUUID()}.json.tmp`);
  let locked = false;
  try {
    const version: string = typeof req.body?.version === "string" ? req.body.version.trim() : "";
    // Manual uploads of CI artifacts retain the build encoded in their filename.
    const rawCode = String(req.body?.versionCode ?? file.originalname.match(/-build(\d+)\.apk$/i)?.[1] ?? "");
    const versionCode = Number(rawCode);
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+$/.test(rawCode) ||
        !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
      res.status(400).json({ error: "A numeric version (x.y.z) and valid Android versionCode are required" });
      return;
    }
    const sha256 = await hashFile(file.path);
    if (req.body?.sha256 && req.body.sha256 !== sha256) {
      res.status(400).json({ error: "APK checksum mismatch" });
      return;
    }
    await fsp.mkdir(MOBILE_APP_DIR, { recursive: true });
    try {
      await fsp.mkdir(lockPath);
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      res.status(409).json({ error: "Another APK publication is in progress; retry later" });
      return;
    }
    const current = await readManifest();
    if (current) {
      const oldParts = current.version.split('.').map(Number);
      const newParts = version.split('.').map(Number);
      const difference = newParts.map((part, index) => part - oldParts[index]).find(n => n !== 0);
      if ((current.versionCode != null && versionCode < current.versionCode) ||
          (oldParts.length === 3 && oldParts.every(Number.isFinite) && difference != null && difference < 0)) {
        res.status(409).json({ error: "An older APK cannot replace the published release" });
        return;
      }
      if (versionCode === current.versionCode) {
        const oldHash = current.sha256 || await hashFile(apkPath(current));
        if (version !== current.version || sha256 !== oldHash) {
          res.status(409).json({ error: "This build number already belongs to a different APK" });
          return;
        }
        res.json(responseManifest({ ...current, sha256: oldHash }));
        return;
      }
    }
    // Immutable files let downloads finish safely while the manifest advances.
    const storageFile = `AzurePlayer-${versionCode}-${sha256}.apk`;
    const target = path.join(MOBILE_APP_DIR, storageFile);
    await fsp.copyFile(file.path, target);
    const stat = await fsp.stat(target);
    const manifest: MobileAppManifest = {
      appName: "Azure Player", version, versionCode,
      fileName: `AzurePlayer-v${version}-build${versionCode}.apk`,
      size: stat.size, updatedAt: new Date().toISOString(), sha256, storageFile,
    };
    await fsp.writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fsp.rename(manifestTemp, path.join(MOBILE_APP_DIR, MANIFEST_FILENAME));
    res.json(responseManifest(manifest));
  } catch (error) {
    console.error("Failed to publish Azure Player APK", error);
    res.status(500).json({ error: "Failed to publish APK" });
  } finally {
    await fsp.unlink(file.path).catch(() => undefined);
    await fsp.unlink(manifestTemp).catch(() => undefined);
    if (locked) await fsp.rmdir(lockPath).catch(() => undefined);
  }
};
