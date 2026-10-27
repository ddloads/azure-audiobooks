import prisma from "../lib/prisma";
import { createLogger } from "../lib/logger";
import { fetchAudibleChapters, isAsin } from "./audnexus";

// Upgrades books whose chapters were generated (even spacing, pauses, files)
// to Audible's chapters, one ASIN lookup at a time. Runs in the background in
// the main server process; progress is kept in memory for the admin UI.

const logger = createLogger("audible-chapters");
// Audnexus is a free community service; don't hammer it.
const DELAY_BETWEEN_LOOKUPS_MS = 300;

export interface AudibleChapterBackfillStatus {
  running: boolean;
  total: number;
  processed: number;
  updated: number;
  notFound: number;
  mismatched: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
}

let status: AudibleChapterBackfillStatus = {
  running: false,
  total: 0,
  processed: 0,
  updated: 0,
  notFound: 0,
  mismatched: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
};

export const getAudibleChapterBackfillStatus = (): AudibleChapterBackfillStatus => ({ ...status });

const GENERIC_CHAPTER_TITLE = /^chapter \d+$/i;

/**
 * Books chaptered before sources were tracked count as generated only when
 * every title is a plain "Chapter N", so real embedded chapters are left alone.
 */
export const looksGenerated = (book: { chaptersSource: string | null; chapters: { title: string }[] }) =>
  book.chaptersSource === "generated" ||
  (book.chaptersSource === null && book.chapters.every((chapter) => GENERIC_CHAPTER_TITLE.test(chapter.title.trim())));

const findCandidates = async () => {
  const books = await prisma.book.findMany({
    where: { asin: { not: null }, duration: { gt: 0 }, OR: [{ chaptersSource: null }, { chaptersSource: "generated" }] },
    select: { id: true, asin: true, duration: true, chaptersSource: true, chapters: { select: { title: true } } },
  });
  return books.filter((book) => isAsin(book.asin) && looksGenerated(book));
};

const run = async (candidates: Awaited<ReturnType<typeof findCandidates>>) => {
  for (const book of candidates) {
    try {
      const result = await fetchAudibleChapters(book.asin!, book.duration);
      if (result.status === "ok") {
        await prisma.$transaction([
          prisma.chapter.deleteMany({ where: { bookId: book.id } }),
          prisma.chapter.createMany({ data: result.chapters.map((chapter) => ({ ...chapter, bookId: book.id })) }),
          prisma.book.update({ where: { id: book.id }, data: { chaptersSource: "audible" } }),
        ]);
        status.updated++;
      } else if (result.status === "not-found") {
        status.notFound++;
      } else if (result.status === "mismatch") {
        status.mismatched++;
      } else {
        status.failed++;
      }
    } catch (error) {
      status.failed++;
      logger.warn("Failed to apply Audible chapters", { bookId: book.id, error: String(error) });
    }
    status.processed++;
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_LOOKUPS_MS));
  }
};

/** Starts the backfill unless one is already running. Returns the status either way. */
export const startAudibleChapterBackfill = async (): Promise<{ started: boolean; status: AudibleChapterBackfillStatus }> => {
  if (status.running) return { started: false, status: getAudibleChapterBackfillStatus() };

  status = { running: true, total: 0, processed: 0, updated: 0, notFound: 0, mismatched: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null };
  try {
    const candidates = await findCandidates();
    status.total = candidates.length;
    logger.info("Audible chapter backfill started", { books: candidates.length });

    void run(candidates).finally(() => {
      status.running = false;
      status.finishedAt = new Date().toISOString();
      logger.info("Audible chapter backfill finished", { ...status });
    });
  } catch (error) {
    status.running = false;
    status.finishedAt = new Date().toISOString();
    throw error;
  }

  return { started: true, status: getAudibleChapterBackfillStatus() };
};
