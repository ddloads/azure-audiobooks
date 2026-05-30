import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";

export const getBookmarks = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const bookId = typeof req.params["bookId"] === "string" ? req.params["bookId"] : null;
  if (!userId || !bookId) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId, bookId },
      orderBy: { position: "asc" },
    });
    res.json(bookmarks);
  } catch {
    res.status(500).json({ error: "Failed to fetch bookmarks" });
  }
};

export const createBookmark = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { bookId, position, label } = req.body as { bookId?: string; position?: number; label?: string };
  if (!userId || !bookId || typeof position !== "number") {
    res.status(400).json({ error: "Invalid bookmark payload" });
    return;
  }
  try {
    const bookmark = await prisma.bookmark.create({
      data: { userId, bookId, position, label: label ?? null },
    });
    res.status(201).json(bookmark);
  } catch {
    res.status(500).json({ error: "Failed to create bookmark" });
  }
};

export const updateBookmark = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = typeof req.params["id"] === "string" ? req.params["id"] : null;
  const { label } = req.body as { label?: string | null };
  if (!userId || !id) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const result = await prisma.bookmark.updateMany({
      where: { id, userId },
      data: { label: label ?? null },
    });
    if (result.count === 0) { res.status(404).json({ error: "Bookmark not found" }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to update bookmark" });
  }
};

export const deleteBookmark = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = typeof req.params["id"] === "string" ? req.params["id"] : null;
  if (!userId || !id) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    await prisma.bookmark.deleteMany({ where: { id, userId } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete bookmark" });
  }
};
