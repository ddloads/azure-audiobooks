import pg from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,
  max: 10,
  idleTimeoutMillis: 600_000,
  connectionTimeoutMillis: 60_000,
});

pool.query("SELECT 1").catch(() => {});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
export default prisma;
