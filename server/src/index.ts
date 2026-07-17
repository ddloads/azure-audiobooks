import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { initSocket } from "./lib/socket";
import { backupDatabase } from "./utils/backup";
import { installConsoleLogger, installProcessLogger, logger } from "./lib/logger";
import { startLibraryWatchers, stopLibraryWatchers } from "./lib/libraryWatcher";
import { reapStaleSilenceCheckJobs, shutdownSilenceChecks } from "./lib/silenceCheckPool";
import { reapStaleScanJobs, shutdownScanning } from "./lib/scanJobPool";
import prisma from "./lib/prisma";

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const server = http.createServer(app);
let shuttingDown = false;
let backupTimer: NodeJS.Timeout | null = null;

installConsoleLogger();
installProcessLogger();

// Initialize Socket.io
initSocket(server);

const startServer = async () => {
  server.listen(Number(PORT), HOST, () => {
    logger.info(`Server is running on http://${HOST}:${PORT}`, { host: HOST, port: Number(PORT) });
  });

  // Daily backup
  backupTimer = setInterval(() => {
    void backupDatabase();
  }, 24 * 60 * 60 * 1000);

  // Initial backup
  void backupDatabase();

  const reapedSilence = await reapStaleSilenceCheckJobs();
  if (reapedSilence > 0) {
    logger.info(`Reaped ${reapedSilence} stale silence check job(s) from previous run`);
  }
  const reapedScans = await reapStaleScanJobs();
  if (reapedScans > 0) {
    logger.info(`Reaped ${reapedScans} stale scan job(s) from previous run`);
  }

  startLibraryWatchers();
};

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down`);

  if (backupTimer) clearInterval(backupTimer);
  await stopLibraryWatchers();
  await Promise.allSettled([shutdownScanning(), shutdownSilenceChecks()]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
};

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});
process.once("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

startServer().catch((error) => {
  logger.error("Failed to start server", error);
  process.exit(1);
});
