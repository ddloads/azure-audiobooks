import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import {
  clearStoredActiveAudibleProfile,
  deleteAudibleCliProfile,
  getAudibleCliStatus,
  getAudibleConfigDir,
  listAudibleCliProfiles,
  renameAudibleCliProfile,
  sanitizeAudibleProfileName,
  setStoredActiveAudibleProfile,
} from "../../utils/audibleCli";
import { getSingleBodyValue } from "./shared";

const execFileAsync = promisify(execFile);

const AUDIBLE_AUTH_STATE_DIR = path.join(process.cwd(), "data", "temp", "audible-auth");
const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

const VALID_MARKETPLACES = new Set(["us", "uk", "de", "fr", "ca", "it", "au", "in", "jp", "es"]);
const AUDIBLE_AUTH_TOKEN_PATTERN = /^[a-f0-9-]{36}$/i;

const getAudibleAuthStateFile = (authToken: string) =>
  path.join(AUDIBLE_AUTH_STATE_DIR, `${authToken}.json`);

const getAudibleProfileName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const sanitized = sanitizeAudibleProfileName(value);
  return sanitized || null;
};

const resolvePythonExe = async (): Promise<string> => {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ["--version"], { timeout: 5_000, windowsHide: true });
      return cmd;
    } catch {
      // try next
    }
  }
  return candidates[0];
};

const runPythonScript = async (script: string, args: string[]): Promise<Record<string, unknown>> => {
  const python = await resolvePythonExe();
  try {
    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch (err: any) {
    if (err.stdout) {
      try {
        return JSON.parse((err.stdout as string).trim()) as Record<string, unknown>;
      } catch {
        // stdout wasn't JSON — fall through to re-throw
      }
    }
    throw err;
  }
};

export const getAudibleCliStatusHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = await getAudibleCliStatus();
    res.json(status);
  } catch (error) {
    console.error("Get audible-cli status error:", error);
    res.status(500).json({ error: "Failed to check audible-cli status" });
  }
};

export const startAudibleCliAuth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const marketplace = getSingleBodyValue(req.body?.marketplace) ?? "us";
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!VALID_MARKETPLACES.has(marketplace)) {
      res.status(400).json({ error: "Invalid marketplace code" });
      return;
    }
    if (!profileName) {
      res.status(400).json({ error: "Profile name is required" });
      return;
    }

    const scriptPath = path.join(SCRIPTS_DIR, "audible_auth_get_url.py");
    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: "Auth script not found on server" });
      return;
    }

    if (!fs.existsSync(AUDIBLE_AUTH_STATE_DIR)) {
      fs.mkdirSync(AUDIBLE_AUTH_STATE_DIR, { recursive: true });
    }
    const authToken = crypto.randomUUID();
    const stateFile = getAudibleAuthStateFile(authToken);

    const result = await runPythonScript(scriptPath, [stateFile, marketplace, profileName]);

    if (!result.ok) {
      res.status(500).json({ error: result.error ?? "Failed to generate login URL" });
      return;
    }

    res.json({ url: result.url, marketplace, profileName, authToken });
  } catch (error) {
    console.error("Start audible-cli auth error:", error);
    res.status(500).json({ error: "Failed to start authentication" });
  }
};

export const completeAudibleCliAuth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const redirectUrl = getSingleBodyValue(req.body?.redirectUrl);
    const authToken = getSingleBodyValue(req.body?.authToken);
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!redirectUrl) {
      res.status(400).json({ error: "Redirect URL is required" });
      return;
    }
    if (!authToken || !AUDIBLE_AUTH_TOKEN_PATTERN.test(authToken)) {
      res.status(400).json({ error: "Auth session token is required" });
      return;
    }
    if (!profileName) {
      res.status(400).json({ error: "Profile name is required" });
      return;
    }

    const stateFile = getAudibleAuthStateFile(authToken);
    if (!fs.existsSync(stateFile)) {
      res.status(400).json({ error: "No pending authentication session found. Please start over." });
      return;
    }

    const scriptPath = path.join(SCRIPTS_DIR, "audible_auth_complete.py");
    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: "Auth script not found on server" });
      return;
    }

    const configDir = getAudibleConfigDir();
    const outputFile = path.join(configDir, `${profileName}.json`);

    const result = await runPythonScript(scriptPath, [stateFile, redirectUrl, outputFile]);

    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Failed to complete authentication" });
      return;
    }

    setStoredActiveAudibleProfile(profileName);
    res.json({ ok: true, file: result.file, profileName });
  } catch (error) {
    console.error("Complete audible-cli auth error:", error);
    res.status(500).json({ error: "Failed to complete authentication" });
  }
};

export const setActiveAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!profileName) {
      clearStoredActiveAudibleProfile();
      res.json({ ok: true, activeProfile: null });
      return;
    }

    const exists = listAudibleCliProfiles().some((profile) => profile.name === profileName);
    if (!exists) {
      res.status(404).json({ error: "Audible profile not found" });
      return;
    }

    setStoredActiveAudibleProfile(profileName);
    res.json({ ok: true, activeProfile: profileName });
  } catch (error) {
    console.error("Set active audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to set active profile" });
  }
};

export const deleteAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.params.profileName);
    if (!profileName) {
      res.status(400).json({ error: "Invalid profile name" });
      return;
    }

    const deleted = deleteAudibleCliProfile(profileName);
    if (!deleted) {
      res.status(404).json({ error: "Audible profile not found" });
      return;
    }

    const status = await getAudibleCliStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    console.error("Delete audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to delete Audible profile" });
  }
};

export const renameAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.params.profileName);
    const nextProfileName = getAudibleProfileName(req.body?.profileName);

    if (!profileName || !nextProfileName) {
      res.status(400).json({ error: "Current and new profile names are required" });
      return;
    }

    const result = renameAudibleCliProfile(profileName, nextProfileName);
    if (!result.ok) {
      res.status(result.error === "Audible profile not found" ? 404 : 400).json({
        error: result.error ?? "Failed to rename Audible profile",
      });
      return;
    }

    const status = await getAudibleCliStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    console.error("Rename audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to rename Audible profile" });
  }
};
