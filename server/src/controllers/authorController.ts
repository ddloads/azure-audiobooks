import { Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { normalizeCoverPath } from "../utils/covers";

export const getAuthors = async (req: AuthRequest, res: Response) => {
  try {
    const authors = await prisma.author.findMany({
      include: {
        _count: { select: { books: true } },
        books: {
          select: { coverPath: true },
          where: { coverPath: { not: null } },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(
      authors.map((author) => ({
        id: author.id,
        name: author.name,
        bookCount: author._count.books,
        coverPath: author.books[0]?.coverPath
          ? normalizeCoverPath(author.books[0].coverPath)
          : null,
      })),
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch authors" });
  }
};
