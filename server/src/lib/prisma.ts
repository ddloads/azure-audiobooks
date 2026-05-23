import pg from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
export default prisma;
