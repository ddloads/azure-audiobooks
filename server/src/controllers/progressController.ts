import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { normalizeCoverPath } from "../utils/covers";
import { getAppearanceSettings } from "../utils/appSettings";

const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const hasTag = (value: string | null | undefined, tagName: string) =>
  (value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .includes(tagName.toLowerCase());

export const getAllUserProgress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [appearanceSettings, records] = await Promise.all([
      getAppearanceSettings(),
      prisma.progress.findMany({
        where: {
          userId,
          currentTime: { gt: 30 },
          isFinished: false,
        },
        include: {
          book: { include: { author: true } },
        },
        orderBy: { lastUpdate: "desc" },
        take: 20,
      }),
    ]);

    const visibleRecords = appearanceSettings.showReviewBooks
      ? records
      : records.filter((record) => !hasTag(record.book.tags, "review"));

    res.json(
      visibleRecords.map((r) => ({
        ...r,
        book: { ...r.book, coverPath: normalizeCoverPath(r.book.coverPath) },
      })),
    );
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch progress" });
  }
};

export const getProgress = async (req: AuthRequest, res: Response) => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    const userId = req.user?.userId;

    if (!bookId || !userId) {
      res.status(400).json({ error: "Invalid progress request" });
      return;
    }

    const progress = await prisma.progress.findUnique({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
    });

    res.json(progress || { currentTime: 0, isFinished: false });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch progress" });
  }
};

export const getFinishedBooks = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const records = await prisma.progress.findMany({
      where: { userId, isFinished: true },
      include: {
        book: { include: { author: true, series: true } },
      },
      orderBy: { lastUpdate: "desc" },
    });
    res.json(
      records.map((r) => ({
        ...r,
        book: { ...r.book, coverPath: normalizeCoverPath(r.book.coverPath) },
      })),
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch finished books" });
  }
};

export const deleteProgress = async (req: AuthRequest, res: Response) => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    const userId = req.user?.userId;
    if (!bookId || !userId) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    await prisma.progress.deleteMany({ where: { userId, bookId } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete progress" });
  }
};

export const updateProgress = async (req: AuthRequest, res: Response) => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    const { currentTime, isFinished } = req.body;
    const userId = req.user?.userId;

    if (!bookId || !userId || typeof currentTime !== "number") {
      res.status(400).json({ error: "Invalid progress payload" });
      return;
    }

    const progress = await prisma.progress.upsert({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      update: {
        currentTime,
        isFinished,
      },
      create: {
        userId,
        bookId,
        currentTime,
        isFinished: Boolean(isFinished),
      },
    });

    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: "Failed to update progress" });
  }
};
