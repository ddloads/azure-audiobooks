import { Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { AuthRequest } from "../middleware/authMiddleware";

function detectPlatform(ua: string | undefined): string {
  if (!ua) return "Unknown";
  const s = ua.toLowerCase();
  let os = "Unknown";
  if (s.includes("iphone") || s.includes("ipod")) os = "iOS";
  else if (s.includes("ipad")) os = "iPadOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("windows nt")) os = "Windows";
  else if (s.includes("macintosh") || s.includes("mac os x")) os = "macOS";
  else if (s.includes("linux")) os = "Linux";
  let browser = "Unknown";
  if (s.includes("edg/")) browser = "Edge";
  else if (s.includes("chrome/")) browser = "Chrome";
  else if (s.includes("firefox/")) browser = "Firefox";
  else if (s.includes("safari/") && s.includes("version/")) browser = "Safari";
  else if (s.includes("safari/")) browser = "Safari";
  return `${browser} on ${os}`;
}

export const startSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const bookId = typeof req.body.bookId === "string" ? req.body.bookId : null;

    if (!userId || !bookId) {
      res.status(400).json({ error: "bookId required" });
      return;
    }

    const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const platform = detectPlatform(req.headers["user-agent"]);
    const session = await prisma.listeningSession.create({
      data: { id: randomUUID(), userId, bookId, platform },
      select: { id: true, startedAt: true },
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error("Failed to start listening session", error);
    res.status(500).json({ error: "Failed to start session" });
  }
};

export const updateSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const id = req.params["id"] as string;
    const secondsListened =
      typeof req.body.secondsListened === "number" && req.body.secondsListened >= 0
        ? Math.round(req.body.secondsListened)
        : null;
    const ended = req.body.ended === true;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const existing = await prisma.listeningSession.findFirst({
      where: { id, userId },
      select: { id: true, endedAt: true },
    });

    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const data: {
      secondsListened?: number;
      endedAt?: Date;
    } = {};

    if (secondsListened !== null) data.secondsListened = secondsListened;
    if (ended) data.endedAt = new Date();

    const updated = await prisma.listeningSession.update({
      where: { id },
      data,
      select: { id: true, secondsListened: true, endedAt: true },
    });

    res.json(updated);
  } catch (error) {
    logger.error("Failed to update listening session", error);
    res.status(500).json({ error: "Failed to update session" });
  }
};

export const getUserStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayAgg, weekAgg, monthAgg, allTimeAgg, recentSessions] = await Promise.all([
      prisma.listeningSession.aggregate({
        where: { userId, startedAt: { gte: startOfToday } },
        _sum: { secondsListened: true },
      }),
      prisma.listeningSession.aggregate({
        where: { userId, startedAt: { gte: startOfWeek } },
        _sum: { secondsListened: true },
      }),
      prisma.listeningSession.aggregate({
        where: { userId, startedAt: { gte: startOfMonth } },
        _sum: { secondsListened: true },
      }),
      prisma.listeningSession.aggregate({
        where: { userId },
        _sum: { secondsListened: true },
        _count: { id: true },
      }),
      prisma.listeningSession.findMany({
        where: { userId },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          secondsListened: true,
          platform: true,
          book: { select: { id: true, title: true, coverPath: true, author: { select: { name: true } } } },
        },
      }),
    ]);

    res.json({
      todaySeconds:    todayAgg._sum.secondsListened    ?? 0,
      weekSeconds:     weekAgg._sum.secondsListened     ?? 0,
      monthSeconds:    monthAgg._sum.secondsListened    ?? 0,
      allTimeSeconds:  allTimeAgg._sum.secondsListened  ?? 0,
      sessionCount:    allTimeAgg._count.id,
      recentSessions,
    });
  } catch (error) {
    logger.error("Failed to get user listening stats", error);
    res.status(500).json({ error: "Failed to load stats" });
  }
};

export const getUserSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const sessions = await prisma.listeningSession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        secondsListened: true,
        platform: true,
        book: { select: { id: true, title: true, coverPath: true, author: { select: { name: true } } } },
      },
    });
    res.json(sessions);
  } catch (error) {
    logger.error("Failed to get user sessions", error);
    res.status(500).json({ error: "Failed to load sessions" });
  }
};

export const listAdminSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit)) || 25), 100);
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;

    const where = userId ? { userId } : {};
    const [sessions, total] = await Promise.all([
      prisma.listeningSession.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          secondsListened: true,
          platform: true,
          book: { select: { id: true, title: true, coverPath: true, author: { select: { name: true } } } },
          user: { select: { id: true, username: true } },
        },
      }),
      prisma.listeningSession.count({ where }),
    ]);

    res.json({ sessions, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    logger.error("Failed to list admin sessions", error);
    res.status(500).json({ error: "Failed to load sessions" });
  }
};

export const getAdminStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const [todayAgg, weekAgg, topListeners, topBooks] = await Promise.all([
      prisma.listeningSession.aggregate({
        where: { startedAt: { gte: startOfToday } },
        _sum: { secondsListened: true },
        _count: { id: true },
      }),
      prisma.listeningSession.aggregate({
        where: { startedAt: { gte: startOfWeek } },
        _sum: { secondsListened: true },
      }),
      prisma.listeningSession.groupBy({
        by: ["userId"],
        where: { startedAt: { gte: startOfWeek } },
        _sum: { secondsListened: true },
        orderBy: { _sum: { secondsListened: "desc" } },
        take: 5,
      }),
      prisma.listeningSession.groupBy({
        by: ["bookId"],
        where: { startedAt: { gte: startOfWeek } },
        _sum: { secondsListened: true },
        orderBy: { _sum: { secondsListened: "desc" } },
        take: 5,
      }),
    ]);

    const userIds = topListeners.map((l) => l.userId);
    const bookIds = topBooks.map((b) => b.bookId);

    const [users, books] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
      prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true, title: true, author: { select: { name: true } } } }),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const bookMap = Object.fromEntries(books.map((b) => [b.id, b]));

    res.json({
      todaySeconds:     todayAgg._sum.secondsListened ?? 0,
      todaySessions:    todayAgg._count.id,
      weekSeconds:      weekAgg._sum.secondsListened ?? 0,
      topListeners: topListeners.map((l) => ({
        user: userMap[l.userId] ?? { id: l.userId, username: "Unknown" },
        weekSeconds: l._sum.secondsListened ?? 0,
      })),
      topBooks: topBooks.map((b) => ({
        book: bookMap[b.bookId] ?? { id: b.bookId, title: "Unknown" },
        weekSeconds: b._sum.secondsListened ?? 0,
      })),
    });
  } catch (error) {
    logger.error("Failed to get admin listening stats", error);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
};
