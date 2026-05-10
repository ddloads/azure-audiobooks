import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";


export const normalizeSourcePath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(process.cwd(), trimmed);
};

// Helper to handle long Windows paths (MAX_PATH limit) for external tools
export const preparePathForTool = (filePath: string, useForwardSlashes = false): string => {
  let processedPath = filePath;

  if (process.platform === "win32") {
    if (filePath.length >= 250 || filePath.startsWith("\\\\")) {
      if (!filePath.startsWith("\\\\?\\")) {
        if (filePath.startsWith("\\\\")) {
          // UNC path: \\server\share -> \\?\UNC\server\share
          processedPath = `\\\\?\\UNC\\${filePath.substring(2)}`;
        } else {
          // Local path: C:\path -> \\?\C:\path
          processedPath = `\\\\?\\${filePath}`;
        }
      }
    }
  }

  if (useForwardSlashes) {
    return processedPath.replace(/\\/g, "/");
  }

  return processedPath;
};

export const ensureStorageFolders = () => {
  // No-op: covers are now stored in each book's folder within the library volume
};

export const getConfiguredLibraries = async (libraryId?: string) => {
  ensureStorageFolders();

  return prisma.library.findMany({
    where: {
      isActive: true,
      ...(libraryId ? { id: libraryId } : {}),
    },
    include: {
      sources: {
        where: { isEnabled: true },
        orderBy: [{ isWritable: "desc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
};

export const resolveWritableLibrarySource = async (libraryId: string) => {
  const source = await prisma.librarySource.findFirst({
    where: {
      libraryId,
      isEnabled: true,
      isWritable: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (!source) {
    return null;
  }

  return {
    ...source,
    resolvedPath: normalizeSourcePath(source.path),
  };
};
