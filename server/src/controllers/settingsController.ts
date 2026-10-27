import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  AppearanceSettings,
  ScanSettings,
  getAppearanceSettings,
  getRegistrationSettings,
  getScanSettings,
  updateAppearanceSettings,
  updateRegistrationSettings,
  updateScanSettings,
} from "../utils/appSettings";
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

export const getScanSettingsHandler = async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getScanSettings());
  } catch (error) {
    res.status(500).json({ error: "Failed to load scan settings" });
  }
};

const SCAN_BOOL_KEYS: (keyof ScanSettings)[] = ["fastStartEnabled", "silenceChapters"];

export const updateScanSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    for (const key of SCAN_BOOL_KEYS) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") {
        res.status(400).json({ error: `${key} must be a boolean` });
        return;
      }
    }

    const updates: Partial<ScanSettings> = {};
    for (const key of SCAN_BOOL_KEYS) {
      if (typeof body[key] === "boolean") {
        updates[key] = body[key] as boolean;
      }
    }

    res.json(await updateScanSettings(updates));
  } catch (error) {
    res.status(500).json({ error: "Failed to update scan settings" });
  }
};

export const getRegistrationSettingsHandler = async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getRegistrationSettings());
  } catch (error) {
    res.status(500).json({ error: "Failed to load registration settings" });
  }
};

export const updateRegistrationSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const openRegistration = (req.body as Record<string, unknown>)?.openRegistration;
    if (typeof openRegistration !== "boolean") {
      res.status(400).json({ error: "openRegistration must be a boolean" });
      return;
    }
    res.json(await updateRegistrationSettings({ openRegistration }));
  } catch (error) {
    res.status(500).json({ error: "Failed to update registration settings" });
  }
};
