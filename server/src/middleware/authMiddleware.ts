import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { enrichRequestLogContext } from "./loggingMiddleware";
import { getJwtSecret } from "../utils/securityConfig";

const JWT_SECRET = getJwtSecret();
const AUTH_COOKIE_NAME = "auth_token";

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface AuthUser {
  userId: string;
  role: string;
  tokenVersion: number;
}

export interface AuthTokenPayload {
  userId: string;
  tokenVersion: number;
}

const getTokenFromCookies = (cookieHeader?: string): string | null => {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === AUTH_COOKIE_NAME) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
};

export const extractAuthToken = (req: Request): string | null => {
  return extractTokenFromHeaders(req.headers.authorization, req.headers.cookie);
};

export const extractTokenFromHeaders = (
  authorization: string | undefined,
  cookieHeader: string | undefined,
): string | null => {
  const [scheme, value] = authorization?.split(" ", 2) ?? [];
  if (scheme?.toLowerCase() === "bearer" && value) return value;

  return getTokenFromCookies(cookieHeader);
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  const decoded = jwt.verify(token, JWT_SECRET) as Partial<AuthTokenPayload>;
  if (
    typeof decoded.userId !== "string" ||
    typeof decoded.tokenVersion !== "number" ||
    !Number.isInteger(decoded.tokenVersion) ||
    decoded.tokenVersion < 0
  ) {
    throw new Error("Invalid auth token payload");
  }
  return { userId: decoded.userId, tokenVersion: decoded.tokenVersion };
};

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = extractAuthToken(req);

  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  let decoded: AuthTokenPayload;
  try {
    decoded = verifyAuthToken(token);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, tokenVersion: true },
    });

    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    req.user = {
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    enrichRequestLogContext(req);
    next();
  } catch {
    res.status(500).json({ error: "Authentication service unavailable" });
  }
};

export const authorizeAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};

export { AUTH_COOKIE_NAME };
