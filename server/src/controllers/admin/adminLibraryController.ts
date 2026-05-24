import prisma from "../../lib/prisma";
import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { createLogger } from "../../lib/logger";
import { refreshLibraryWatchers } from "../../lib/libraryWatcher";
import { normalizeSourcePath } from "../../utils/libraryConfig";
import {
  getSingleParam,
  getSingleBodyValue,
  isBoolean,
} from "./shared";

const adminLogger = createLogger("admin");

const validateLibrarySourcePath = (inputPath: string) => {
  const resolvedPath = normalizeSourcePath(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    return { error: "Assigned path does not exist", resolvedPath };
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    return { error: "Assigned path must be a folder", resolvedPath };
  }

  return { error: null, resolvedPath };
};

const getAvailableRoots = () => {
  if (process.platform === "win32") {
    return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
      .filter((rootPath) => {
        try {
          return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.localeCompare(b));
  }

  return [path.parse(process.cwd()).root];
};

const getParentFolder = (folderPath: string) => {
  const normalizedPath = normalizeSourcePath(folderPath);
  const parentPath = path.dirname(normalizedPath);
  return parentPath === normalizedPath ? null : parentPath;
};

const refreshWatchersSoon = () => {
  refreshLibraryWatchers().catch((error) => {
    adminLogger.error("Failed to refresh library watchers", error);
  });
};

export const browseLibraryFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawPath = typeof req.query.path === "string" ? req.query.path : null;
    const requestedPath = rawPath?.trim() || null;
    const roots = getAvailableRoots();

    if (!requestedPath) {
      res.json({
        roots,
        currentPath: null,
        parentPath: null,
        directories: [],
      });
      return;
    }

    const normalizedPath = normalizeSourcePath(requestedPath);
    if (!fs.existsSync(normalizedPath)) {
      res.status(400).json({ error: "Folder does not exist" });
      return;
    }

    if (!fs.statSync(normalizedPath).isDirectory()) {
      res.status(400).json({ error: "Selected path is not a folder" });
      return;
    }

    const directories = fs
      .readdirSync(normalizedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(normalizedPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      roots,
      currentPath: normalizedPath,
      parentPath: getParentFolder(normalizedPath),
      directories,
    });
  } catch (error) {
    console.error("Browse library folders error:", error);
    res.status(500).json({ error: "Failed to browse folders" });
  }
};

export const listLibraries = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraries = await prisma.library.findMany({
      include: {
        sources: {
          orderBy: [{ isWritable: "desc" }, { createdAt: "asc" }],
        },
        _count: {
          select: {
            books: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(libraries);
  } catch (error) {
    console.error("List libraries error:", error);
    res.status(500).json({ error: "Failed to load libraries" });
  }
};

export const createLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = getSingleBodyValue(req.body.name);
    const description = getSingleBodyValue(req.body.description);

    if (!name) {
      res.status(400).json({ error: "Library name is required" });
      return;
    }

    const existingLibrary = await prisma.library.findUnique({ where: { name } });
    if (existingLibrary) {
      res.status(400).json({ error: "Library name already exists" });
      return;
    }

    const library = await prisma.library.create({
      data: {
        name,
        description: description || null,
      },
      include: {
        sources: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    res.status(201).json(library);
    adminLogger.info("Library created", {
      libraryId: library.id,
      name: library.name,
    });
  } catch (error) {
    console.error("Create library error:", error);
    res.status(500).json({ error: "Failed to create library" });
  }
};

export const updateLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const existingLibrary = await prisma.library.findUnique({ where: { id: libraryId } });
    if (!existingLibrary) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const name = getSingleBodyValue(req.body.name);
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : undefined;
    const isActive = isBoolean(req.body.isActive) ? req.body.isActive : undefined;
    const folderPatternRaw =
      typeof req.body.folderPattern === "string" ? req.body.folderPattern.trim() : undefined;

    if (name && name !== existingLibrary.name) {
      const duplicate = await prisma.library.findUnique({ where: { name } });
      if (duplicate) {
        res.status(400).json({ error: "Library name already exists" });
        return;
      }
    }

    const library = await prisma.library.update({
      where: { id: libraryId },
      data: {
        name: name || undefined,
        description: description === undefined ? undefined : description || null,
        isActive,
        folderPattern: folderPatternRaw === undefined ? undefined : folderPatternRaw || null,
      },
      include: {
        sources: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    res.json(library);
    refreshWatchersSoon();
    adminLogger.info("Library updated", {
      libraryId: library.id,
      name: library.name,
      isActive: library.isActive,
    });
  } catch (error) {
    console.error("Update library error:", error);
    res.status(500).json({ error: "Failed to update library" });
  }
};

export const deleteLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    if (library._count.books > 0) {
      res.status(400).json({ error: "Delete or move this library's books before removing it" });
      return;
    }

    await prisma.library.delete({ where: { id: libraryId } });
    refreshWatchersSoon();
    adminLogger.warn("Library deleted", {
      libraryId: library.id,
      name: library.name,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete library error:", error);
    res.status(500).json({ error: "Failed to delete library" });
  }
};

export const purgeLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            books: true,
            sources: true,
          },
        },
      },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const purgeResult = await prisma.book.deleteMany({
      where: { libraryId },
    });

    adminLogger.warn("Library purged", {
      libraryId: library.id,
      name: library.name,
      deletedBooks: purgeResult.count,
      retainedSources: library._count.sources,
    });

    res.json({
      message: `Purged ${purgeResult.count} books from ${library.name}`,
      deletedBooks: purgeResult.count,
      library: {
        id: library.id,
        name: library.name,
      },
    });
  } catch (error) {
    console.error("Purge library error:", error);
    res.status(500).json({ error: "Failed to purge library" });
  }
};

export const createLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({ where: { id: libraryId } });
    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const inputPath = getSingleBodyValue(req.body.path);
    const label = getSingleBodyValue(req.body.label);
    const kind = getSingleBodyValue(req.body.kind) || "LOCAL";
    const isWritable = isBoolean(req.body.isWritable) ? req.body.isWritable : false;
    const isEnabled = isBoolean(req.body.isEnabled) ? req.body.isEnabled : true;

    if (!inputPath) {
      res.status(400).json({ error: "Source path is required" });
      return;
    }

    const validation = validateLibrarySourcePath(inputPath);
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const source = await prisma.librarySource.create({
      data: {
        libraryId,
        label: label || null,
        path: validation.resolvedPath,
        kind,
        isWritable,
        isEnabled,
        isWatched: isBoolean(req.body.isWatched) ? req.body.isWatched : false,
      },
    });

    res.status(201).json(source);
    refreshWatchersSoon();
    adminLogger.info("Library source created", {
      sourceId: source.id,
      libraryId: source.libraryId,
      path: source.path,
      kind: source.kind,
      isWritable: source.isWritable,
      isEnabled: source.isEnabled,
      isWatched: source.isWatched,
    });
  } catch (error) {
    console.error("Create library source error:", error);
    res.status(500).json({ error: "Failed to create source path" });
  }
};

export const updateLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sourceId = getSingleParam(req.params.sourceId);
    if (!sourceId) {
      res.status(400).json({ error: "Invalid source id" });
      return;
    }

    const source = await prisma.librarySource.findUnique({ where: { id: sourceId } });
    if (!source) {
      res.status(404).json({ error: "Source path not found" });
      return;
    }

    const inputPath = getSingleBodyValue(req.body.path);
    const label =
      typeof req.body.label === "string" ? req.body.label.trim() : undefined;
    const kind = getSingleBodyValue(req.body.kind);
    const isWritable = isBoolean(req.body.isWritable) ? req.body.isWritable : undefined;
    const isEnabled = isBoolean(req.body.isEnabled) ? req.body.isEnabled : undefined;
    const isWatched = isBoolean(req.body.isWatched) ? req.body.isWatched : undefined;

    let normalizedPath: string | undefined;
    if (inputPath) {
      const validation = validateLibrarySourcePath(inputPath);
      if (validation.error) {
        res.status(400).json({ error: validation.error });
        return;
      }

      normalizedPath = validation.resolvedPath;
    }

    const updatedSource = await prisma.librarySource.update({
      where: { id: sourceId },
      data: {
        label: label === undefined ? undefined : label || null,
        path: normalizedPath,
        kind: kind || undefined,
        isWritable,
        isEnabled,
        isWatched,
      },
    });

    res.json(updatedSource);
    refreshWatchersSoon();
    adminLogger.info("Library source updated", {
      sourceId: updatedSource.id,
      libraryId: updatedSource.libraryId,
      path: updatedSource.path,
      kind: updatedSource.kind,
      isWritable: updatedSource.isWritable,
      isEnabled: updatedSource.isEnabled,
      isWatched: updatedSource.isWatched,
    });
  } catch (error) {
    console.error("Update library source error:", error);
    res.status(500).json({ error: "Failed to update source path" });
  }
};

export const deleteLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sourceId = getSingleParam(req.params.sourceId);
    if (!sourceId) {
      res.status(400).json({ error: "Invalid source id" });
      return;
    }

    const source = await prisma.librarySource.findUnique({ where: { id: sourceId } });
    if (!source) {
      res.status(404).json({ error: "Source path not found" });
      return;
    }

    const librarySourceCount = await prisma.librarySource.count({
      where: { libraryId: source.libraryId },
    });

    if (librarySourceCount <= 1) {
      res.status(400).json({ error: "Each library must keep at least one source path" });
      return;
    }

    await prisma.librarySource.delete({ where: { id: sourceId } });
    refreshWatchersSoon();
    adminLogger.warn("Library source deleted", {
      sourceId: source.id,
      libraryId: source.libraryId,
      path: source.path,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete library source error:", error);
    res.status(500).json({ error: "Failed to delete source path" });
  }
};

// ── Library structure check helpers ───────────────────────────────────────────

const checkSegmentMatch = (actual: string, patternSeg: string): boolean => {
  const literals = patternSeg.split(/\{[^}]+\}/).filter((s) => s.length > 0);
  if (literals.length === 0) return true;
  let pos = 0;
  for (const literal of literals) {
    const idx = actual.toLowerCase().indexOf(literal.toLowerCase(), pos);
    if (idx === -1) return false;
    pos = idx + literal.length;
  }
  return true;
};

const matchesPattern = (
  folderPath: string,
  sourceRoots: string[],
  pattern: string,
): boolean => {
  const normFolder = folderPath.replace(/\\/g, "/");
  const normFolderLower = normFolder.toLowerCase();

  let relPath: string | null = null;
  for (const root of sourceRoots) {
    const normRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
    const normRootLower = normRoot.toLowerCase();
    if (normFolderLower.startsWith(normRootLower + "/")) {
      relPath = normFolder.slice(normRoot.length + 1);
      break;
    } else if (normFolderLower === normRootLower) {
      relPath = "";
      break;
    }
  }

  if (relPath === null) return false;

  const relSegs = relPath.split("/").filter(Boolean);
  const patSegs = pattern.replace(/\\/g, "/").split("/");

  if (relSegs.length !== patSegs.length) return false;

  return relSegs.every((seg, i) => checkSegmentMatch(seg, patSegs[i]));
};

export const checkLibraryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { sources: { select: { path: true } } },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    if (!library.folderPattern) {
      res.status(400).json({ error: "No folder pattern configured for this library" });
      return;
    }

    const books = await prisma.book.findMany({
      where: { libraryId },
      select: {
        id: true,
        title: true,
        folderPath: true,
        author: { select: { name: true } },
      },
      orderBy: { title: "asc" },
    });

    const sourceRoots = library.sources.map((s) => s.path);
    const { folderPattern } = library;

    const nonConforming = books
      .filter((book) => !matchesPattern(book.folderPath, sourceRoots, folderPattern))
      .map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author.name,
        folderPath: book.folderPath,
      }));

    res.json({
      pattern: folderPattern,
      total: books.length,
      conforming: books.length - nonConforming.length,
      nonConforming,
    });
  } catch (error) {
    console.error("Check library structure error:", error);
    res.status(500).json({ error: "Failed to check library structure" });
  }
};
