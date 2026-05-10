import fs from "fs";
import path from "path";

const resolveDatabasePath = (): string | null => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) return null;

  const relativePath = databaseUrl.slice("file:".length);
  return path.resolve(process.cwd(), relativePath);
};

export const backupDatabase = (): string | null => {
  const dbPath = resolveDatabasePath();
  const backupDir = path.join(process.cwd(), "data", "backups");

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

  if (dbPath && fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`Database backed up to ${backupPath}`);

    // Keep only last 7 backups
    const files = fs.readdirSync(backupDir).sort();
    if (files.length > 7) {
      for (let i = 0; i < files.length - 7; i++) {
        fs.unlinkSync(path.join(backupDir, files[i]));
      }
    }

    return backupPath;
  }

  return null;
};
