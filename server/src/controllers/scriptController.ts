import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { createLogger } from "../lib/logger";
import { listAdminScripts, runAdminScript } from "../utils/adminScripts";

const scriptLogger = createLogger("admin-scripts");

export const listAdminScriptsHandler = async (_req: AuthRequest, res: Response) => {
  res.json(listAdminScripts());
};

export const runAdminScriptHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { scriptId } = req.body as { scriptId?: unknown };
    if (typeof scriptId !== "string" || !scriptId.trim()) {
      res.status(400).json({ error: "scriptId is required" });
      return;
    }

    scriptLogger.warn("Admin script requested", {
      scriptId,
      userId: req.user?.userId,
      role: req.user?.role,
    });

    const result = await runAdminScript(scriptId);
    if (!result) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    scriptLogger.warn("Admin script finished", {
      scriptId,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      userId: req.user?.userId,
    });

    res.json(result);
  } catch (error) {
    scriptLogger.error("Admin script failed to start", error);
    res.status(500).json({ error: "Failed to run script" });
  }
};
