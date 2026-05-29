import { Prisma } from "@prisma/client";
import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { normalizeCoverPath } from "../utils/covers";
import { getAppearanceSettings } from "../utils/appSettings";

const reviewFilter: Prisma.BookWhereInput = {
  tags: { contains: "review", mode: "insensitive" },
};

export const getAuthors = async (req: AuthRequest, res: Response) => {
  try {
    const appearanceSettings = await getAppearanceSettings();

    const bookFilter: Prisma.BookWhereInput = appearanceSettings.showReviewBooks
      ? {}
      : { NOT: { tags: { contains: "review", mode: "insensitive" } } };

    const [authors, reviewCounts] = await Promise.all([
      prisma.author.findMany({
        where: { books: { some: bookFilter } },
        include: {
          _count: { select: { books: { where: bookFilter } } },
          books: {
            select: { coverPath: true },
            where: { coverPath: { not: null }, ...bookFilter },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.book.groupBy({
        by: ["authorId"],
        where: reviewFilter,
        _count: { id: true },
      }),
    ]);

    const reviewMap = new Map(
      reviewCounts.map((r) => [r.authorId, r._count.id]),
    );

    res.json(
      authors.map((author) => ({
        id: author.id,
        name: author.name,
        bookCount: author._count.books,
        reviewCount: reviewMap.get(author.id) ?? 0,
        coverPath: author.books[0]?.coverPath
          ? normalizeCoverPath(author.books[0].coverPath)
          : null,
      })),
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch authors" });
  }
};
