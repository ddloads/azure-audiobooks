import prisma from "../lib/prisma";
import { createLogger } from "../lib/logger";
import { invalidateRecommendationCache } from "../lib/recommendationCache";
import { invalidateFilterOptionsCache } from "../controllers/libraryController";
import {
  MATCHED_TAG,
  applyMatchedFieldsToBook,
  buildFieldsFromMatchCandidate,
  defaultQuickMatchSelectedFields,
  hasManagedTag,
} from "../controllers/admin/books/shared";
import { fetchAudibleProductByAsin } from "./audibleCli";

// A downloaded file only carries a few tags (title, author, sometimes a
// description), so after the scan imports it the book gets Audible's full
// metadata, the same way a manual "Match" would apply it.

const logger = createLogger("audible-download");

type DownloadedTitle = {
  asin: string;
  profile: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesName: string | null;
  seriesSequence: string | null;
};

/** Applies Audible's metadata to a downloaded book. Falls back to what the library sync stored. */
export const applyAudibleMetadataToBook = async (bookId: string, title: DownloadedTitle) => {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true, title: true, folderPath: true, tags: true } });
  if (!book) return false;

  const product = await fetchAudibleProductByAsin(title.asin, title.profile);
  // The cover already came down with the audio at full size.
  const selectedFields = { ...defaultQuickMatchSelectedFields, imageUrl: false };

  if (product && product.metadata.asin?.toUpperCase() === title.asin.toUpperCase()) {
    await applyMatchedFieldsToBook(book, selectedFields, buildFieldsFromMatchCandidate(product), [MATCHED_TAG]);
  } else {
    logger.warn("Audible catalog lookup failed; using library details", { asin: title.asin });
    await applyMatchedFieldsToBook(
      book,
      { title: true, subtitle: true, author: true, narrator: true, seriesName: true, seriesSequence: true, asin: true },
      {
        title: title.title,
        subtitle: title.subtitle,
        author: title.author?.split(",")[0]?.trim() || null,
        narrator: title.narrator,
        seriesName: title.seriesName,
        seriesSequence: title.seriesSequence,
        asin: title.asin,
      },
      [MATCHED_TAG],
    );
  }

  invalidateFilterOptionsCache();
  invalidateRecommendationCache();
  return true;
};

/** Fills in metadata for titles downloaded before the download step did it. */
export const backfillDownloadedAudibleMetadata = async () => {
  const downloads = await prisma.audibleLibraryItem.findMany({
    where: { downloadStatus: "done", downloadedPath: { not: null } },
  });

  let updated = 0;
  for (const download of downloads) {
    try {
      const book = await prisma.book.findFirst({
        where: { folderPath: { equals: download.downloadedPath!, mode: "insensitive" } },
        select: { id: true, tags: true },
      });
      if (!book || hasManagedTag(book.tags, MATCHED_TAG)) continue;
      if (await applyAudibleMetadataToBook(book.id, download)) updated++;
    } catch (error) {
      logger.warn("Metadata backfill failed", { asin: download.asin, error: String(error) });
    }
  }
  if (updated) logger.info("Filled in metadata for downloaded Audible titles", { updated });
  return updated;
};
