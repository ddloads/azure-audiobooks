import { Request, Response } from "express";
import type { CookieOptions } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { AUTH_COOKIE_NAME, AuthRequest } from "../middleware/authMiddleware";
import {
  findUserByEmailInsensitive,
  findUserByUsernameInsensitive,
  isValidEmail,
  sanitizeEmail,
  sanitizeUsername,
} from "../utils/usernames";

// In-memory pairing codes for mobile QR connect. Single-use, 5-minute TTL.
const pairingCodes = new Map<string, { userId: string; role: string; expiresAt: number }>();
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of pairingCodes.entries()) {
    if (entry.expiresAt <= now) pairingCodes.delete(code);
  }
}, 60_000);

function generatePairingCode(): string {
  // Omit easily confused characters: I, O, 0, 1
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-me";
const authCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const issueAuthToken = (userId: string, role: string) =>
  jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "7d" });

const setAuthCookie = (res: Response, token: string) => {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = sanitizeUsername(req.body?.username);
    const email = sanitizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!username || !email || !password) {
      res.status(400).json({ error: "Username, email, and password are required" });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }

    const existingUser = await findUserByUsernameInsensitive(username);
    if (existingUser) {
      res.status(400).json({ error: "Username already exists" });
      return;
    }

    const existingEmail = await findUserByEmailInsensitive(email);
    if (existingEmail) {
      res.status(400).json({ error: "Email already exists" });
      return;
    }

    // Check if this is the first user, if so, make them admin
    const userCount = await prisma.user.count();
    const role = userCount === 0 ? "ADMIN" : "USER";

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role,
      },
    });

    const token = issueAuthToken(user.id, user.role);
    setAuthCookie(res, token);

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = sanitizeUsername(req.body?.username);
    const password = req.body?.password;

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const user = await findUserByUsernameInsensitive(username);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = issueAuthToken(user.id, user.role);
    setAuthCookie(res, token);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, username: true, email: true, role: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateMyEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const email = sanitizeEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }

    const existingEmail = await findUserByEmailInsensitive(email);
    if (existingEmail && existingEmail.id !== req.user.userId) {
      res.status(400).json({ error: "Email already exists" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { email },
      select: { id: true, username: true, email: true, role: true },
    });

    res.json(user);
  } catch (error) {
    console.error("Update email error:", error);
    res.status(500).json({ error: "Failed to update email" });
  }
};

export const updateMyUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const username = sanitizeUsername(req.body?.username);
    if (!username) {
      res.status(400).json({ error: "Username is required" });
      return;
    }
    if (username.length < 2 || username.length > 32) {
      res.status(400).json({ error: "Username must be between 2 and 32 characters" });
      return;
    }

    const existing = await findUserByUsernameInsensitive(username);
    if (existing && existing.id !== req.user.userId) {
      res.status(400).json({ error: "Username already taken" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { username },
      select: { id: true, username: true, email: true, role: true },
    });

    res.json(user);
  } catch (error) {
    console.error("Update username error:", error);
    res.status(500).json({ error: "Failed to update username" });
  }
};

export const updateMyPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };

    if (!currentPassword || typeof currentPassword !== "string") {
      res.status(400).json({ error: "Current password is required" });
      return;
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashed },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Update password error:", error);
    res.status(500).json({ error: "Failed to update password" });
  }
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions);
  res.status(204).send();
};

export const createPairingCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, role: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const code = generatePairingCode();
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
    pairingCodes.set(code, { userId: user.id, role: user.role, expiresAt });

    res.json({ pairingCode: code, expiresAt });
  } catch (error) {
    res.status(500).json({ error: "Failed to create pairing code" });
  }
};

export const redeemPairingCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { pairingCode } = req.body;

    if (!pairingCode || typeof pairingCode !== "string") {
      res.status(400).json({ error: "Pairing code is required" });
      return;
    }

    const code = pairingCode.toUpperCase().trim();
    const entry = pairingCodes.get(code);

    if (!entry || entry.expiresAt <= Date.now()) {
      pairingCodes.delete(code);
      res.status(404).json({ error: "Invalid or expired pairing code" });
      return;
    }

    pairingCodes.delete(code);

    const user = await prisma.user.findUnique({
      where: { id: entry.userId },
      select: { id: true, username: true, email: true, role: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const token = issueAuthToken(user.id, user.role);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: "Failed to redeem pairing code" });
  }
};
