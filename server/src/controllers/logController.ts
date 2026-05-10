import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { clearLogs, listLogs, LogLevel, logger } from "../lib/logger";

const VALID_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

const parsePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseRequestedLevels = (value: unknown): LogLevel[] | undefined => {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const requestedLevels = rawValues
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry): entry is LogLevel => VALID_LEVELS.has(entry as LogLevel));

  if (requestedLevels.length === 0) {
    return undefined;
  }

  return Array.from(new Set(requestedLevels));
};

export const listSystemLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = req.query.scope === "metadata" ? "metadata" : "all";

    const result = listLogs({
      levels: parseRequestedLevels(req.query.levels ?? req.query.level),
      scope,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      page: parsePositiveInt(req.query.page, 1),
      limit: parsePositiveInt(req.query.limit, 100),
    });

    res.json(result);
  } catch (error) {
    logger.error("Failed to list logs", error);
    res.status(500).json({ error: "Failed to load logs" });
  }
};

export const clearSystemLogs = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.locals.skipRequestLog = true;
    clearLogs();
    res.status(204).send();
  } catch (error) {
    logger.error("Failed to clear logs", error);
    res.status(500).json({ error: "Failed to clear logs" });
  }
};
