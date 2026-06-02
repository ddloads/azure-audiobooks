import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

const repoRoot = process.cwd();
const playerRoot = process.env.AZURE_PLAYER_ROOT || "E:\\Software Dev\\AzurePlayer";
const releaseDir = path.join(playerRoot, "android", "app", "build", "outputs", "apk", "release");
const targetDir = path.join(repoRoot, "server", "data", "mobile");
const containerArgIndex = process.argv.findIndex((arg) => arg === "--container");
const containerName =
  containerArgIndex >= 0
    ? process.argv[containerArgIndex + 1] || "azure-server"
    : process.env.AZURE_SERVER_CONTAINER;

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

const manifest = {
  appName: "Azure Player",
  version,
  fileName: latest.name,
  size: latest.stat.size,
  updatedAt: new Date().toISOString(),
};

const targetApk = path.join(targetDir, "azure-player-latest.apk");
const targetManifest = path.join(targetDir, "azure-player-latest.json");
await fs.mkdir(targetDir, { recursive: true });
await fs.copyFile(latest.fullPath, targetApk);
await fs.writeFile(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const runDocker = (args) => {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

if (containerName) {
  runDocker(["exec", containerName, "mkdir", "-p", "/app/data/mobile"]);
  runDocker(["cp", targetApk, `${containerName}:/app/data/mobile/azure-player-latest.apk`]);
  runDocker(["cp", targetManifest, `${containerName}:/app/data/mobile/azure-player-latest.json`]);
}

console.log(`Published ${latest.name}`);
console.log(`Version: ${version}`);
console.log(`Size: ${(latest.stat.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`Target: ${targetApk}`);
if (containerName) {
  console.log(`Container target: ${containerName}:/app/data/mobile/azure-player-latest.apk`);
}
