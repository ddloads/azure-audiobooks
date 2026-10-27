import prisma from "../lib/prisma";
import { createLogger } from "../lib/logger";
import { findAsinForBook } from "./audibleCatalog";
import {
  applyAudibleChaptersToBook,
  getAudibleChapterBackfillStatus,
  looksGenerated,
} from "./audibleChapterBackfill";

// Gives books without an ASIN one, using Audible's catalog with strict runtime
// and author matching, then upgrades their generated chapters to Audible's.
// Only the ASIN changes; the rest of the book's metadata is left alone.

const logger = createLogger("asin-finder");
// Two Audible-side requests per book at most; keep the pace gentle.
const DELAY_BETWEEN_BOOKS_MS = 300;

export interface AsinFinderStatus {
  running: boolean;
  total: number;
  processed: number;
  found: number;
  noMatch: number;
  failed: number;
  chaptersUpdated: number;
  startedAt: string | null;
  finishedAt: string | null;
}

let status: AsinFinderStatus = {
  running: false,
  total: 0,
  processed: 0,
  found: 0,
  noMatch: 0,
  failed: 0,
  chaptersUpdated: 0,
  startedAt: null,
  finishedAt: null,
};

export const isAsinFinderRunning = () => status.running;
export const getAsinFinderStatus = (): AsinFinderStatus => ({ ...status });

const findCandidates = () =>
  prisma.book.findMany({
    where: { asin: null, duration: { gt: 0 } },
    select: {
      id: true,
      title: true,
      duration: true,
      chaptersSource: true,
      author: { select: { name: true } },
      chapters: { select: { title: true } },
    },
    orderBy: { title: "asc" },
  });

const run = async (books: Awaited<ReturnType<typeof findCandidates>>) => {
  for (const book of books) {
    try {
      const lookup = await findAsinForBook({ title: book.title, author: book.author.name, duration: book.duration });
      if (lookup.status === "found") {
        // Only fill an empty ASIN; never overwrite one set meanwhile.
        const claimed = await prisma.book.updateMany({ where: { id: book.id, asin: null }, data: { asin: lookup.asin } });
        if (claimed.count === 1) {
          status.found++;
          if (looksGenerated(book)) {
            const outcome = await applyAudibleChaptersToBook({ id: book.id, asin: lookup.asin, duration: book.duration });
            if (outcome === "updated") status.chaptersUpdated++;
          }
        }
      } else if (lookup.status === "no-match") {
        status.noMatch++;
      } else {
        status.failed++;
        logger.warn("ASIN lookup failed", { bookId: book.id, reason: lookup.reason });
      }
    } catch (error) {
      status.failed++;
      logger.warn("ASIN lookup failed", { bookId: book.id, error: String(error) });
    }
    status.processed++;
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BOOKS_MS));
  }
};

/** Starts the finder unless it (or the chapter backfill) is already running. */
export const startAsinFinder = async (): Promise<{ started: boolean; status: AsinFinderStatus }> => {
  if (status.running || getAudibleChapterBackfillStatus().running) return { started: false, status: getAsinFinderStatus() };

  status = {
    running: true,
    total: 0,
    processed: 0,
    found: 0,
    noMatch: 0,
    failed: 0,
    chaptersUpdated: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  try {
    const books = await findCandidates();
    status.total = books.length;
    logger.info("ASIN finder started", { books: books.length });

    void run(books).finally(() => {
      status.running = false;
      status.finishedAt = new Date().toISOString();
      logger.info("ASIN finder finished", { ...status });
    });
  } catch (error) {
    status.running = false;
    status.finishedAt = new Date().toISOString();
    throw error;
  }

  return { started: true, status: getAsinFinderStatus() };
};
