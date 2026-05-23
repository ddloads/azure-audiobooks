process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

import "./env-setup";

import http from "http";
import app from "./app";
import { initSocket } from "./lib/socket";
import { backupDatabase } from "./utils/backup";
import { installConsoleLogger, installProcessLogger, logger } from "./lib/logger";

console.log("[startup] importing modules complete");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const server = http.createServer(app);

installConsoleLogger();
installProcessLogger();

initSocket(server);

const startServer = async () => {
  server.listen(Number(PORT), HOST, () => {
    logger.info(`Server is running on http://${HOST}:${PORT}`, { host: HOST, port: Number(PORT) });
  });

  setInterval(() => {
    backupDatabase();
  }, 24 * 60 * 60 * 1000);

  backupDatabase();
};

startServer().catch((error) => {
  console.error("[FATAL] Failed to start server:", error);
  process.exit(1);
});
