import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { normalizeCoverPath } from "../utils/covers";
import { getOrFetchBooks, CachedBook } from "./libraryController";

const normalizeForResponse = (b: CachedBook) => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle,
  duration: b.duration,
  coverPath: normalizeCoverPath(b.coverPath),
  sequence: b.sequence,
  narrator: b.narrator,
  genres: b.genres,
  author: { id: b.authorId, name: b.author.name },
  series: b.series,
});

export const getRecommendations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [allProgress, allBooks] = await Promise.all([
      prisma.progress.findMany({
        where: { userId },
        select: { bookId: true, currentTime: true, isFinished: true },
      }),
      getOrFetchBooks(),
    ]);

    const finishedBookIds = new Set(allProgress.filter((p) => p.isFinished).map((p) => p.bookId));
    const engagedBookIds = new Set(
      allProgress.filter((p) => p.isFinished || p.currentTime > 30).map((p) => p.bookId),
    );

    const booksById = new Map(allBooks.map((b) => [b.id, b]));

    // Lane 1: Up Next in Series
    const nextInSeries: ReturnType<typeof normalizeForResponse>[] = [];
    const seenNextIds = new Set<string>();

    for (const id of finishedBookIds) {
      const finished = booksById.get(id);
      if (!finished?.series || finished.sequence == null) continue;

      const seriesId = finished.series.id;
      const seq = finished.sequence;

      const next = allBooks
        .filter(
          (b) =>
            b.series?.id === seriesId &&
            b.sequence != null &&
            b.sequence > seq &&
            !engagedBookIds.has(b.id),
        )
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))[0];

      if (next && !seenNextIds.has(next.id)) {
        seenNextIds.add(next.id);
        nextInSeries.push(normalizeForResponse(next));
      }
    }

    // Lane 2: You Might Like (content-based scoring from finished books)
    let youMightLike: ReturnType<typeof normalizeForResponse>[] = [];

    if (finishedBookIds.size > 0) {
      const likedAuthorIds = new Set<string>();
      const likedNarrators = new Set<string>();
      const likedGenres = new Set<string>();

      for (const id of finishedBookIds) {
        const b = booksById.get(id);
        if (!b) continue;
        likedAuthorIds.add(b.authorId);
        if (b.narrator) likedNarrators.add(b.narrator.toLowerCase());
        if (b.genres) {
          for (const g of b.genres.split(",").map((g) => g.trim().toLowerCase()).filter(Boolean)) {
            likedGenres.add(g);
          }
        }
      }

      youMightLike = allBooks
        .filter((b) => !engagedBookIds.has(b.id))
        .map((book) => {
          let score = 0;
          if (likedAuthorIds.has(book.authorId)) score += 4;
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
        .map(({ book }) => normalizeForResponse(book));
    }

    res.json({ nextInSeries, youMightLike });
  } catch (error) {
    console.error("Recommendations error:", error);
    process.stderr.write(
      `[recommendations] ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
};
