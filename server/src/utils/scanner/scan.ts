import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";
import { buildChapters } from "./chapter-source";
import { getConfiguredLibraries, normalizeSourcePath } from "../libraryConfig";
import { getCoverUrl } from "../covers";
import {
  AUDIO_EXTENSIONS,
  METADATA_VERSION,
  type LibraryWithSources,
  type DiscoveredFolder,
  type ScanRunContext,
  canonicalizeFolderPath,
} from "./shared";
import { discoverBookFolders, removeMissingBooks } from "./folder-discovery";
import { upsertBookFolder } from "./folder-sync";
import { SCAN_FOLDER_CONCURRENCY, isFolderUnchanged, mapWithConcurrency, type KnownBook } from "./scan-helpers";

// Unchanged books finish in microseconds, so only report every Nth of them.
const SKIPPED_PROGRESS_EVERY = 25;

const loadKnownBooks = async (libraryId: string) => {
  const books: KnownBook[] = await prisma.book.findMany({
    where: { libraryId },
    select: {
      id: true,
      folderPath: true,
      coverPath: true,
      metadataVersion: true,
      audioFiles: { select: { filename: true, path: true }, orderBy: { index: "asc" } },
      _count: { select: { chapters: true } },
    },
  });
  return new Map(books.map((book) => [canonicalizeFolderPath(book.folderPath), book]));
};

export const scanLibrary = async (libraryId?: string, context: ScanRunContext = {}) => {
  const emitProgress = context.emitProgress ?? (() => {});
  const shouldStop = context.shouldStop ?? (() => false);

  const libraries = await getConfiguredLibraries(libraryId);
  if (shouldStop()) return;

  emitProgress({
    libraryId,
    status: "starting",
    progress: 0,
  });

  let totalDiscovered = 0;
  let processedCount = 0;

  const allDiscovered: { library: LibraryWithSources; folders: DiscoveredFolder[] }[] = [];
  for (const library of libraries) {
    if (shouldStop()) return;

    const discoveredFolders = discoverBookFolders(library, shouldStop);
    allDiscovered.push({ library, folders: discoveredFolders });
    totalDiscovered += discoveredFolders.length;
  }

  for (const { library, folders } of allDiscovered) {
    if (shouldStop()) return;

    const sourceRoots = library.sources
      .map((source) => canonicalizeFolderPath(source.path))
      .filter((sourcePath) => fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory());

    const discoveredPaths = new Set(folders.map((entry) => canonicalizeFolderPath(entry.folderPath)));
    await removeMissingBooks(library.id, discoveredPaths, sourceRoots);
    const knownBooks = await loadKnownBooks(library.id);

    await mapWithConcurrency(folders, SCAN_FOLDER_CONCURRENCY, async (folder) => {
      if (shouldStop()) return;

      const knownBook = knownBooks.get(canonicalizeFolderPath(folder.folderPath));
      const unchanged =
        !!knownBook &&
        isFolderUnchanged({ folderPath: normalizeSourcePath(folder.folderPath), files: folder.files }, knownBook, {
          metadataVersion: METADATA_VERSION,
          audioExtensions: AUDIO_EXTENSIONS,
          coverUrl: getCoverUrl(knownBook.id),
        });

      processedCount++;
      if (!unchanged || processedCount % SKIPPED_PROGRESS_EVERY === 0) {
        emitProgress({
          libraryId: library.id,
          status: "scanning",
          progress: totalDiscovered > 0 ? Math.round((processedCount / totalDiscovered) * 100) : 100,
          currentFolder: folder.folderName,
          totalFolders: totalDiscovered,
          scannedFolders: processedCount,
        });
      }
      if (unchanged) return;

      try {
        await upsertBookFolder(folder, shouldStop);
      } catch (error) {
        console.error(`Failed to process folder ${folder.folderPath}:`, error);
      }
    });
  }

  if (shouldStop()) return;

  emitProgress({
    libraryId,
    status: "completed",
    progress: 100,
  });

  await prisma.author.deleteMany({
    where: { books: { none: {} } },
  });

  await prisma.series.deleteMany({
    where: { books: { none: {} } },
  });
};

export const rescanBook = async (bookId: string, forceMetadata: boolean = false) => {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { libraryId: true, folderPath: true },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  if (!fs.existsSync(book.folderPath)) {
    throw new Error("Folder does not exist");
  }

  const folderPath = book.folderPath;
  const files = fs.readdirSync(folderPath);

  await upsertBookFolder(
    {
      libraryId: book.libraryId,
      folderName: path.basename(folderPath),
      folderPath,
      files,
    },
    () => false,
    forceMetadata,
  );
};

export const autoChapterizeBook = async (bookId: string, replaceExisting = true) => {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      title: true,
      asin: true,
      duration: true,
      audioFiles: {
        select: {
          filename: true,
          title: true,
          path: true,
          duration: true,
          index: true,
        },
        orderBy: { index: "asc" },
      },
      _count: { select: { chapters: true } },
    },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  if (!replaceExisting && book._count.chapters > 0) {
    return { created: 0, skipped: true, source: null };
  }

  // An explicit request: try Audible and pauses regardless of the scan switches.
  const { chapters, source } = await buildChapters({
    asin: book.asin,
    audioFiles: book.audioFiles,
    totalDuration: book.duration,
    audible: true,
    silence: true,
  });
  await prisma.chapter.deleteMany({ where: { bookId: book.id } });

  if (chapters.length > 0) {
    await prisma.chapter.createMany({
      data: chapters.map((chapter) => ({
        ...chapter,
        bookId: book.id,
      })),
    });
  }
  await prisma.book.update({ where: { id: book.id }, data: { chaptersSource: chapters.length > 0 ? source : null } });

  return { created: chapters.length, skipped: false, source };
};

