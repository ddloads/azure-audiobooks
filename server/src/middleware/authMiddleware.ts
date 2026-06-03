import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { enrichRequestLogContext } from "./loggingMiddleware";
import { getJwtSecret } from "../utils/securityConfig";

const JWT_SECRET = getJwtSecret();
const AUTH_COOKIE_NAME = "auth_token";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

const getTokenFromCookies = (cookieHeader?: string): string | null => {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
};

export const extractAuthToken = (req: Request): string | null => {
  const headerToken = req.headers.authorization?.split(" ")[1];
  if (headerToken) return headerToken;

  return getTokenFromCookies(req.headers.cookie);
};

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = extractAuthToken(req);

  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
    req.user = decoded;
    enrichRequestLogContext(req);
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
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
