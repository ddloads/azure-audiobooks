import pg from "pg";
import { PrismaClient } from "@prisma/client";

const parseIntegerEnv = (name: string, fallback: number) => {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  min: 0,
  max: parseIntegerEnv("PG_POOL_MAX", 5),
  idleTimeoutMillis: parseIntegerEnv("PG_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMillis: parseIntegerEnv("PG_CONNECTION_TIMEOUT_MS", 10_000),
  maxLifetimeSeconds: parseIntegerEnv("PG_MAX_LIFETIME_SECONDS", 300),
  keepAlive: true,
  query_timeout: parseIntegerEnv("PG_QUERY_TIMEOUT_MS", 30_000),
  statement_timeout: parseIntegerEnv("PG_STATEMENT_TIMEOUT_MS", 30_000),
});

pool.on("error", (error) => {
  console.warn("[database] idle client error:", error);
});

const getPrismaDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return rawUrl;
  }

  const url = new URL(rawUrl);
  if (!url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "1");
  }
  return url.toString();
};

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getPrismaDatabaseUrl(),
    },
  },
});
export default prisma;
