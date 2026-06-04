import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";
import { generateSmartChapters } from "../chapterizer";
import { getConfiguredLibraries } from "../libraryConfig";
import {
  type LibraryWithSources,
  type DiscoveredFolder,
  type ScanRunContext,
  canonicalizeFolderPath,
} from "./shared";
import { discoverBookFolders, removeMissingBooks } from "./folder-discovery";
import { upsertBookFolder } from "./folder-sync";

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

    for (const folder of folders) {
      if (shouldStop()) return;

      try {
        processedCount++;
        const progress = totalDiscovered > 0 ? Math.round((processedCount / totalDiscovered) * 100) : 100;

        emitProgress({
          libraryId: library.id,
          status: "scanning",
          progress,
          currentFolder: folder.folderName,
          totalFolders: totalDiscovered,
          scannedFolders: processedCount,
        });

        await upsertBookFolder(folder, shouldStop);
      } catch (error) {
        console.error(`Failed to process folder ${folder.folderPath}:`, error);
      }
    }
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
    return { created: 0, skipped: true };
  }

  const chapters = await generateSmartChapters(book.audioFiles, book.duration);
  await prisma.chapter.deleteMany({ where: { bookId: book.id } });

  if (chapters.length > 0) {
    await prisma.chapter.createMany({
      data: chapters.map((chapter) => ({
        ...chapter,
        bookId: book.id,
      })),
    });
  }

  return { created: chapters.length, skipped: false };
};

