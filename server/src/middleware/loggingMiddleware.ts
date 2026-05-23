import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import {
  createLogger,
  runWithRequestContext,
  updateRequestContext,
} from "../lib/logger";
import { AuthRequest } from "./authMiddleware";

const requestLogger = createLogger("http");

const getClientIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim();
  }

  return req.socket.remoteAddress || undefined;
};

export const requestLoggingMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  res.setHeader("x-request-id", requestId);

  runWithRequestContext(
    {
      requestId,
      method: req.method,
      path: req.originalUrl,
      ip: getClientIp(req),
    },
    () => {
      res.on("finish", () => {
        if (res.locals.skipRequestLog) {
          return;
        }

        const durationMs = Date.now() - startedAt;

        requestLogger.http(`${req.method} ${req.originalUrl}`, res.statusCode, durationMs, {
          userAgent: req.headers["user-agent"],
        });

        if (req.originalUrl.startsWith("/api/auth") || res.statusCode >= 500) {
          console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
        }
      });

      next();
    },
  );
};

export const enrichRequestLogContext = (req: AuthRequest) => {
  if (!req.user) return;

  updateRequestContext({
    userId: req.user.userId,
    role: req.user.role,
  });
};

export const setLogTitle = (title: string) => {
  updateRequestContext({ title });
};

export const errorLoggingMiddleware = (
  error: unknown,
  req: AuthRequest,
  res: Response,
  _next: NextFunction,
) => {
  if (res.headersSent) {
    return;
  }

  requestLogger.error(`Unhandled request error for ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({ error: "Internal server error" });
};
