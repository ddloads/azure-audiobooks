import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const resolveDatabasePath = (): string | null => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) return null;

  const relativePath = databaseUrl.slice("file:".length);
  return path.resolve(process.cwd(), relativePath);
};

const getBackupFiles = (backupDir: string) =>
  fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith("backup-") && /\.(db|dump)$/.test(file))
    .sort();

const pruneBackups = (backupDir: string) => {
  const files = getBackupFiles(backupDir);
  if (files.length > 7) {
    for (const file of files.slice(0, files.length - 7)) {
      fs.unlinkSync(path.join(backupDir, file));
    }
  }
};

const backupPostgres = async (databaseUrl: string, backupPath: string) => {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");
  const env = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };

  await execFileAsync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--file", backupPath],
    { env, timeout: 10 * 60 * 1000, windowsHide: true },
  );
};

export const backupDatabase = async (): Promise<string | null> => {
  const dbPath = resolveDatabasePath();
  const backupDir = path.join(process.cwd(), "data", "backups");

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (dbPath && fs.existsSync(dbPath)) {
    const backupPath = path.join(backupDir, `backup-${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`Database backed up to ${backupPath}`);
    pruneBackups(backupDir);
    return backupPath;
  }

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("postgresql://") && !databaseUrl?.startsWith("postgres://")) {
    return null;
  }

  const backupPath = path.join(backupDir, `backup-${timestamp}.dump`);
  try {
    await backupPostgres(databaseUrl, backupPath);
    console.log(`Database backed up to ${backupPath}`);
    pruneBackups(backupDir);
    return backupPath;
  } catch (error) {
    fs.rmSync(backupPath, { force: true });
    console.error("PostgreSQL backup failed:", error);
  }

  return null;
};
