import { PrismaClient } from "@prisma/client";
import process from "process";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL as string,
    },
  },
});

export default prisma;
