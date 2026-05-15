import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { getAppearanceSettings, updateAppearanceSettings } from "../utils/appSettings";
import { invalidateFilterOptionsCache } from "./libraryController";

export const getAppearanceSettingsHandler = async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getAppearanceSettings());
  } catch (error) {
    res.status(500).json({ error: "Failed to load appearance settings" });
  }
};

export const updateAppearanceSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { showReviewBooks } = req.body as { showReviewBooks?: unknown };
    if (showReviewBooks !== undefined && typeof showReviewBooks !== "boolean") {
      res.status(400).json({ error: "showReviewBooks must be a boolean" });
      return;
    }

    const settings = await updateAppearanceSettings({ showReviewBooks });
    invalidateFilterOptionsCache();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to update appearance settings" });
  }
};
