import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";
import { normalizeSourcePath } from "../libraryConfig";
import {
  AUDIO_EXTENSIONS,
  type LibraryWithSources,
  type DiscoveredFolder,
  canonicalizeFolderPath,
  PROTECTED_DIRECTORY_NAMES,
  isProtectedDirectory,
} from "./shared";

export const discoverBookFolders = (
  library: LibraryWithSources,
  shouldStop: () => boolean = () => false,
): DiscoveredFolder[] => {
  const foldersByPath = new Map<string, DiscoveredFolder>();

  const walk = (dirPath: string) => {
    const stack = [dirPath];

    while (stack.length > 0 && !shouldStop()) {
      const currentDir = stack.pop();
      if (!currentDir || !fs.existsSync(currentDir)) {
        continue;
      }

      if (isProtectedDirectory(currentDir)) {
        continue;
      }

      if (!fs.statSync(currentDir).isDirectory()) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (error) {
        console.error(`Error reading directory ${currentDir}:`, error);
        continue;
      }

      const files: string[] = [];
      let hasAudio = false;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (PROTECTED_DIRECTORY_NAMES.has(entry.name)) {
            continue;
          }
          stack.push(path.join(currentDir, entry.name));
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        files.push(entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          hasAudio = true;
        }
      }

      if (hasAudio) {
        const normalizedFolderPath = normalizeSourcePath(currentDir);
        const canonicalFolderPath = canonicalizeFolderPath(normalizedFolderPath);
        foldersByPath.set(canonicalFolderPath, {
          libraryId: library.id,
          folderName: path.basename(normalizedFolderPath),
          folderPath: normalizedFolderPath,
          files,
        });
      }
    }
  };

  for (const source of library.sources) {
    const sourceRoot = normalizeSourcePath(source.path);
    walk(sourceRoot);
  }

  return Array.from(foldersByPath.values());
};

export const removeMissingBooks = async (
  libraryId: string,
  discoveredPaths: Set<string>,
  sourceRoots: string[],
) => {
  const existingBooks = await prisma.book.findMany({
    where: { libraryId },
    select: { id: true, folderPath: true, coverPath: true },
  });

  const missingBookIds = existingBooks
    .filter((book) => {
      const normalizedBookPath = canonicalizeFolderPath(book.folderPath);
      const belongsToCurrentRoots = sourceRoots.some((root) => {
        const relative = path.relative(root, normalizedBookPath);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      });

      return belongsToCurrentRoots && !discoveredPaths.has(normalizedBookPath);
    })
    .map((book) => book.id);

  if (missingBookIds.length > 0) {
    await prisma.book.deleteMany({
      where: { id: { in: missingBookIds } },
    });
    // Cover files live in the book's folder within the library volume — don't delete them
  }
};
