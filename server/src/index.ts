import "./env-setup";

import http from "http";
import app from "./app";
import { initSocket } from "./lib/socket";
import { backupDatabase } from "./utils/backup";
import { installConsoleLogger, installProcessLogger, logger } from "./lib/logger";
import { pool } from "./lib/prisma";

console.log("[startup] importing modules complete");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const server = http.createServer(app);

installConsoleLogger();
installProcessLogger();

initSocket(server);

const startServer = async () => {
  console.log("[startup] warming database connections...");
  try {
    await pool.query("SELECT 1");
    console.log("[startup] database connection ready");
  } catch (error) {
    console.warn("[startup] database warmup failed, continuing anyway:", error);
  }

  server.listen(Number(PORT), HOST, () => {
    logger.info(`Server is running on http://${HOST}:${PORT}`, { host: HOST, port: Number(PORT) });
  });

  // Keep Supabase awake — free tier pauses after 5 min of inactivity
  setInterval(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      // ignore — next real request will reconnect
    }
  }, 4 * 60 * 1000);

  setInterval(() => {
    backupDatabase();
  }, 24 * 60 * 60 * 1000);

  backupDatabase();
};

startServer().catch((error) => {
  console.error("[FATAL] Failed to start server:", error);
  process.exit(1);
});
