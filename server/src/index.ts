import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { initSocket } from "./lib/socket";
import { backupDatabase } from "./utils/backup";
import { installConsoleLogger, installProcessLogger, logger } from "./lib/logger";
import { startLibraryWatchers } from "./lib/libraryWatcher";
import { reapStaleSilenceCheckJobs } from "./lib/silenceCheckPool";
import { reapStaleScanJobs } from "./lib/scanJobPool";

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const server = http.createServer(app);

installConsoleLogger();
installProcessLogger();

// Initialize Socket.io
initSocket(server);

const startServer = async () => {
  server.listen(Number(PORT), HOST, () => {
    logger.info(`Server is running on http://${HOST}:${PORT}`, { host: HOST, port: Number(PORT) });
  });

  // Daily backup
  setInterval(() => {
    backupDatabase();
  }, 24 * 60 * 60 * 1000);

  // Initial backup
  backupDatabase();

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

startServer().catch((error) => {
  logger.error("Failed to start server", error);
  process.exit(1);
});
