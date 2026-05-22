import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { normalizeCoverPath } from "../utils/covers";

const BOOK_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  duration: true,
  coverPath: true,
  sequence: true,
  narrator: true,
  genres: true,
  author: { select: { id: true, name: true } },
  series: { select: { id: true, name: true } },
} as const;

export const getRecommendations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const allProgress = await prisma.progress.findMany({
      where: { userId },
      select: { bookId: true, currentTime: true, isFinished: true },
    });

    const finishedBookIds = allProgress.filter((p) => p.isFinished).map((p) => p.bookId);
    const engagedBookIds = new Set(
      allProgress.filter((p) => p.isFinished || p.currentTime > 30).map((p) => p.bookId),
    );

    const nextInSeries: any[] = [];
    let youMightLike: any[] = [];

    if (finishedBookIds.length > 0) {
      // Lane 1: Up Next in Series
      const finishedSeriesBooks = await prisma.book.findMany({
        where: {
          id: { in: finishedBookIds },
          seriesId: { not: null },
          sequence: { not: null },
        },
        select: { seriesId: true, sequence: true },
      });

      const seenNextIds = new Set<string>();
      const seriesResults = await Promise.all(
        finishedSeriesBooks.map((finished) => {
          if (!finished.seriesId || finished.sequence == null) return Promise.resolve(null);
          return prisma.book.findFirst({
            where: {
              seriesId: finished.seriesId,
              sequence: { gt: finished.sequence },
              id: { notIn: [...engagedBookIds] },
            },
            orderBy: { sequence: "asc" },
            select: BOOK_SELECT,
          });
        }),
      );

      for (const book of seriesResults) {
        if (book && !seenNextIds.has(book.id)) {
          seenNextIds.add(book.id);
          nextInSeries.push(book);
        }
      }

      // Lane 2: You Might Like — content-based scoring
      const finishedBooks = await prisma.book.findMany({
        where: { id: { in: finishedBookIds } },
        select: { author: { select: { id: true } }, narrator: true, genres: true },
      });

      const likedAuthorIds = new Set(finishedBooks.map((b) => b.author.id));
      const likedNarrators = new Set(
        finishedBooks.flatMap((b) => (b.narrator ? [b.narrator.toLowerCase()] : [])),
      );
      const likedGenres = new Set(
        finishedBooks.flatMap((b) =>
          b.genres
            ? b.genres
                .split(",")
                .map((g) => g.trim().toLowerCase())
                .filter(Boolean)
            : [],
        ),
      );

      const candidates = await prisma.book.findMany({
        where: { id: { notIn: [...engagedBookIds] } },
        select: BOOK_SELECT,
      });

      youMightLike = candidates
        .map((book) => {
          let score = 0;
          if (likedAuthorIds.has(book.author.id)) score += 4;
          if (book.narrator && likedNarrators.has(book.narrator.toLowerCase())) score += 2;
          if (book.genres) {
            for (const g of book.genres.split(",").map((g) => g.trim().toLowerCase())) {
              if (likedGenres.has(g)) score += 1;
            }
          }
          return { book, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ book }) => book);
    }

    const normalize = <T extends { coverPath?: string | null }>(b: T): T => ({
      ...b,
      coverPath: normalizeCoverPath(b.coverPath),
    });

    res.json({
      nextInSeries: nextInSeries.map(normalize),
      youMightLike: youMightLike.map(normalize),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
};
