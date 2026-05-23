const isTransientSocketError = (err: unknown) => {
  const code = (err as { code?: string })?.code;
  return code === "EPIPE" || code === "ECONNRESET" || code === "ECONNABORTED";
};

process.on("uncaughtException", (error) => {
  if (isTransientSocketError(error)) return;
  console.error("[FATAL] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  if (isTransientSocketError(reason)) return;
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

import dotenv from "dotenv";
dotenv.config();
