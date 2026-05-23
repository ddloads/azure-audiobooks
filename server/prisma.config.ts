import "dotenv/config";
import { defineConfig } from "prisma/config";

const rawUrl = process.env.DATABASE_URL || "postgresql://dummy@localhost/dummy";
const datasourceUrl = rawUrl.includes("pgbouncer")
  ? rawUrl
  : `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}pgbouncer=true`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
