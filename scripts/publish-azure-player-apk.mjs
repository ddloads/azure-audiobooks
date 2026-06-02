import fs from "fs/promises";
import path from "path";

const repoRoot = process.cwd();
const playerRoot = process.env.AZURE_PLAYER_ROOT || "E:\\Software Dev\\AzurePlayer";
const releaseDir = path.join(playerRoot, "android", "app", "build", "outputs", "apk", "release");
const targetDir = path.join(repoRoot, "server", "data", "mobile");
const targetApk = path.join(targetDir, "azure-player-latest.apk");
const targetManifest = path.join(targetDir, "azure-player-latest.json");

const findLatestApk = async () => {
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  const apks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".apk"))
      .map(async (entry) => {
        const fullPath = path.join(releaseDir, entry.name);
        const stat = await fs.stat(fullPath);
        return { name: entry.name, fullPath, stat };
      }),
  );

  apks.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return apks[0] ?? null;
};

const readVersion = async () => {
  try {
    const raw = await fs.readFile(path.join(playerRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
};

const latest = await findLatestApk();
if (!latest) {
  throw new Error(`No APK files found in ${releaseDir}`);
}

const version = await readVersion();
await fs.mkdir(targetDir, { recursive: true });
await fs.copyFile(latest.fullPath, targetApk);

const manifest = {
  appName: "Azure Player",
  version,
  fileName: latest.name,
  size: latest.stat.size,
  updatedAt: new Date().toISOString(),
  sourcePath: latest.fullPath,
};

await fs.writeFile(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Published ${latest.name}`);
console.log(`Version: ${version}`);
console.log(`Size: ${(latest.stat.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`Target: ${targetApk}`);
