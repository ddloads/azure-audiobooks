import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { AppearanceSettings, getAppearanceSettings, updateAppearanceSettings } from "../utils/appSettings";
import { invalidateFilterOptionsCache } from "./libraryController";

export const getAppearanceSettingsHandler = async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getAppearanceSettings());
  } catch (error) {
    res.status(500).json({ error: "Failed to load appearance settings" });
  }
};

const APPEARANCE_BOOL_KEYS: (keyof AppearanceSettings)[] = [
  "showReviewBooks",
  "shelfContinueListening",
  "shelfNextInSeries",
  "shelfYouMightLike",
  "shelfRecentlyAdded",
];

export const updateAppearanceSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    for (const key of APPEARANCE_BOOL_KEYS) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") {
        res.status(400).json({ error: `${key} must be a boolean` });
        return;
      }
    }

    const updates: Partial<AppearanceSettings> = {};
    for (const key of APPEARANCE_BOOL_KEYS) {
      if (typeof body[key] === "boolean") {
        updates[key] = body[key] as boolean;
      }
    }

    const settings = await updateAppearanceSettings(updates);
    invalidateFilterOptionsCache();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to update appearance settings" });
  }
};
