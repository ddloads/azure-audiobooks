import { Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { AuthRequest } from "../middleware/authMiddleware";

const REPORT_TYPES = new Set([
  "playback",
  "library",
  "metadata",
  "account",
  "performance",
  "visual",
  "other",
]);

const MAX_COMMENT_LENGTH = 2000;
const MAX_PATH_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 500;

const normalizeString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

export const createBugReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const type = typeof req.body.type === "string" ? req.body.type.trim() : "";
    if (!REPORT_TYPES.has(type)) {
      res.status(400).json({ error: "Select a valid issue type" });
      return;
    }

    if (!req.user?.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const rows = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
      INSERT INTO "BugReport" ("id", "type", "comment", "path", "userAgent", "userId")
      VALUES (
        ${randomUUID()},
        ${type},
        ${normalizeString(req.body.comment, MAX_COMMENT_LENGTH)},
        ${normalizeString(req.body.path, MAX_PATH_LENGTH)},
        ${normalizeString(req.headers["user-agent"], MAX_USER_AGENT_LENGTH)},
        ${req.user.userId}
      )
      RETURNING "id", "createdAt"
    `;

    res.status(201).json(rows[0]);
  } catch (error) {
    logger.error("Failed to create bug report", error);
    res.status(500).json({ error: "Failed to submit bug report" });
  }
};

export const listBugReports = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reports = await prisma.$queryRaw`
      SELECT
        br."id",
        br."type",
        br."comment",
        br."path",
        br."userAgent",
        br."createdAt",
        u."id" AS "userId",
        u."username",
        u."email"
      FROM "BugReport" br
      INNER JOIN "User" u ON u."id" = br."userId"
      ORDER BY br."createdAt" DESC
      LIMIT 100
    `;

    res.json(reports);
  } catch (error) {
    logger.error("Failed to list bug reports", error);
    res.status(500).json({ error: "Failed to load bug reports" });
  }
};
