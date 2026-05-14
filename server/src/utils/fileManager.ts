import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";
import { getConfiguredLibraries, normalizeSourcePath } from "./libraryConfig";

export type ManagedRoot = {
  sourceId: string;
  libraryId: string;
  libraryName: string;
  label: string | null;
  path: string;
  resolvedPath: string;
  isWritable: boolean;
};

export type FileManagerEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "directory" | "file";
  size: number;
  modifiedAt: string;
  isProtected: boolean;
};

export type TrashRecord = {
  trashId: string;
  rootId: string;
  originalPath: string;
  trashedPath: string;
  itemName: string;
  itemType: "directory" | "file";
  deletedAt: string;
  deletedBy: string | null;
};

type PreviewSummary = {
  rootId: string;
  libraryId: string;
  itemCount: number;
  fileCount: number;
  directoryCount: number;
  affectedBookCount: number;
  affectedBooks: Array<{ id: string; title: string; folderPath: string }>;
  warnings: string[];
};

const TRASH_DIR_NAME = ".azure-trash";
const TRASH_ITEMS_DIR_NAME = "items";
const TRASH_METADATA_FILE = "metadata.json";
const PROTECTED_TOP_LEVEL_NAMES = new Set([TRASH_DIR_NAME]);
const PROTECTED_SEGMENT_NAMES = new Set([TRASH_DIR_NAME, ".merged-backup"]);

const resolvePath = (inputPath: string) => normalizeSourcePath(inputPath);

const ensureDirectory = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
};

const getRelativeInsideRoot = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  if (relative === "") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the selected library root");
  }
  return relative;
};

const isProtectedRelativePath = (relativePath: string) => {
  if (!relativePath) return true;
  const segments = relativePath.split(path.sep).filter(Boolean);
  return segments.some((segment) => PROTECTED_SEGMENT_NAMES.has(segment));
};

const getProtectedReason = (relativePath: string) => {
  if (!relativePath) return "The library source root cannot be changed";
  const segments = relativePath.split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment === TRASH_DIR_NAME)) {
    return "The managed trash area is protected";
  }
  if (segments.some((segment) => segment === ".merged-backup")) {
    return "Merged backup folders are protected";
  }
  return "This path is protected";
};

const getTrashRootPath = (root: ManagedRoot) => path.join(root.resolvedPath, TRASH_DIR_NAME);
const getTrashItemsPath = (root: ManagedRoot) => path.join(getTrashRootPath(root), TRASH_ITEMS_DIR_NAME);

const statSafe = (targetPath: string) => fs.lstatSync(targetPath);

const toEntry = (root: ManagedRoot, parentPath: string, entry: fs.Dirent): FileManagerEntry => {
  const fullPath = path.join(parentPath, entry.name);
  const stats = statSafe(fullPath);
  const relativePath = getRelativeInsideRoot(root.resolvedPath, fullPath);
  return {
    name: entry.name,
    path: fullPath,
    relativePath,
    type: entry.isDirectory() ? "directory" : "file",
    size: entry.isDirectory() ? 0 : stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isProtected: isProtectedRelativePath(relativePath),
  };
};

const getUniquePath = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) return targetPath;

  const parsed = path.parse(targetPath);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw new Error("Could not resolve a unique destination path");
};

const findManagedRootById = async (rootId: string) => {
  const libraries = await getConfiguredLibraries();
  for (const library of libraries) {
    for (const source of library.sources) {
      if (source.id !== rootId) continue;
      return {
        sourceId: source.id,
        libraryId: library.id,
        libraryName: library.name,
        label: source.label ?? null,
        path: source.path,
        resolvedPath: resolvePath(source.path),
        isWritable: source.isWritable,
      } satisfies ManagedRoot;
    }
  }
  return null;
};

const validateRootPath = (root: ManagedRoot, targetPath: string) => {
  const resolvedPath = resolvePath(targetPath);
  const relativePath = getRelativeInsideRoot(root.resolvedPath, resolvedPath);
  return {
    resolvedPath,
    relativePath,
    isProtected: isProtectedRelativePath(relativePath),
  };
};

const requireWritableRoot = (root: ManagedRoot) => {
  if (!root.isWritable) {
    throw new Error("This library source is read-only");
  }
};

const loadTrashRecord = (root: ManagedRoot, trashId: string): TrashRecord => {
  const itemDir = path.join(getTrashItemsPath(root), trashId);
  const metadataPath = path.join(itemDir, TRASH_METADATA_FILE);
  if (!fs.existsSync(metadataPath)) {
    throw new Error("Trash entry not found");
  }
  return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as TrashRecord;
};

const getRestoreTargetPath = (record: TrashRecord) => {
  const originalDir = path.dirname(record.originalPath);
  ensureDirectory(originalDir);
  if (!fs.existsSync(record.originalPath)) return record.originalPath;

  const parsed = path.parse(record.originalPath);
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(parsed.dir, `${parsed.name} (restored ${suffix})${parsed.ext}`);
};

const buildPreviewSummary = async (root: ManagedRoot, itemPaths: string[]): Promise<PreviewSummary> => {
  const warnings = new Set<string>();
  let fileCount = 0;
  let directoryCount = 0;

  const normalizedPaths = itemPaths.map((itemPath) => validateRootPath(root, itemPath));
  for (const item of normalizedPaths) {
    if (!fs.existsSync(item.resolvedPath)) {
      warnings.add(`${item.resolvedPath} no longer exists`);
      continue;
    }
    const stats = statSafe(item.resolvedPath);
    if (stats.isDirectory()) directoryCount += 1;
    else fileCount += 1;
    if (item.isProtected) warnings.add(getProtectedReason(item.relativePath));
  }

  const books = await prisma.book.findMany({
    where: { libraryId: root.libraryId },
    select: { id: true, title: true, folderPath: true },
  });

  const affectedBooks = books.filter((book) =>
    normalizedPaths.some((item) => {
      const bookFolder = resolvePath(book.folderPath);
      const relativeToBook = path.relative(bookFolder, item.resolvedPath);
      const relativeToItem = path.relative(item.resolvedPath, bookFolder);
      const itemInsideBook = relativeToBook === "" || (!relativeToBook.startsWith("..") && !path.isAbsolute(relativeToBook));
      const bookInsideItem = relativeToItem === "" || (!relativeToItem.startsWith("..") && !path.isAbsolute(relativeToItem));
      return itemInsideBook || bookInsideItem;
    }),
  );

  if (affectedBooks.length > 0) {
    warnings.add("This action affects scanned library content and will queue a library rescan");
  }

  return {
    rootId: root.sourceId,
    libraryId: root.libraryId,
    itemCount: normalizedPaths.length,
    fileCount,
    directoryCount,
    affectedBookCount: affectedBooks.length,
    affectedBooks: affectedBooks.slice(0, 10),
    warnings: Array.from(warnings),
  };
};

export const listManagedRoots = async () => {
  const libraries = await getConfiguredLibraries();
  return libraries.flatMap((library) =>
    library.sources.map((source) => ({
      sourceId: source.id,
      libraryId: library.id,
      libraryName: library.name,
      label: source.label ?? null,
      path: source.path,
      resolvedPath: resolvePath(source.path),
      isWritable: source.isWritable,
    } satisfies ManagedRoot)),
  );
};

export const getManagedRootById = findManagedRootById;

export const listTree = async (rootId: string, currentPath?: string | null) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");

  const targetPath = currentPath?.trim() ? currentPath.trim() : root.resolvedPath;
  const { resolvedPath, relativePath } = validateRootPath(root, targetPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Folder does not exist");
  }
  if (!statSafe(resolvedPath).isDirectory()) {
    throw new Error("Selected path is not a folder");
  }

  const entries = fs
    .readdirSync(resolvedPath, { withFileTypes: true })
    .filter((entry) => !(relativePath === "" && PROTECTED_TOP_LEVEL_NAMES.has(entry.name)))
    .map((entry) => toEntry(root, resolvedPath, entry))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    root,
    currentPath: resolvedPath,
    relativePath,
    parentPath: relativePath ? path.dirname(resolvedPath) : null,
    directories: entries.filter((entry) => entry.type === "directory"),
    files: entries.filter((entry) => entry.type === "file"),
    entries,
  };
};

export const previewOperation = async (rootId: string, itemPaths: string[]) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  return buildPreviewSummary(root, itemPaths);
};

export const createFolder = async (rootId: string, parentPath: string, folderName: string) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);

  const cleanName = folderName.trim();
  if (!cleanName || cleanName === "." || cleanName === ".." || /[\\/:*?"<>|]/.test(cleanName)) {
    throw new Error("Folder name is invalid");
  }

  const parent = validateRootPath(root, parentPath);
  if (parent.isProtected) throw new Error(getProtectedReason(parent.relativePath));
  if (!fs.existsSync(parent.resolvedPath) || !statSafe(parent.resolvedPath).isDirectory()) {
    throw new Error("Parent folder does not exist");
  }

  const targetPath = path.join(parent.resolvedPath, cleanName);
  if (fs.existsSync(targetPath)) throw new Error("A file or folder with that name already exists");

  fs.mkdirSync(targetPath, { recursive: true });
  return { root, targetPath };
};

export const renamePath = async (rootId: string, itemPath: string, nextName: string) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);

  const item = validateRootPath(root, itemPath);
  if (item.isProtected) throw new Error(getProtectedReason(item.relativePath));
  if (!item.relativePath) throw new Error("The library source root cannot be renamed");
  if (!fs.existsSync(item.resolvedPath)) throw new Error("Path does not exist");

  const cleanName = nextName.trim();
  if (!cleanName || cleanName === "." || cleanName === ".." || /[\\/:*?"<>|]/.test(cleanName)) {
    throw new Error("Name is invalid");
  }

  const nextPath = path.join(path.dirname(item.resolvedPath), cleanName);
  const nextValidation = validateRootPath(root, nextPath);
  if (nextValidation.isProtected) throw new Error(getProtectedReason(nextValidation.relativePath));
  if (fs.existsSync(nextPath)) throw new Error("A file or folder with that name already exists");

  fs.renameSync(item.resolvedPath, nextPath);
  return { root, nextPath };
};

export const movePaths = async (rootId: string, itemPaths: string[], destinationPath: string) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);

  const destination = validateRootPath(root, destinationPath);
  if (destination.isProtected) throw new Error(getProtectedReason(destination.relativePath));
  if (!fs.existsSync(destination.resolvedPath) || !statSafe(destination.resolvedPath).isDirectory()) {
    throw new Error("Destination folder does not exist");
  }

  for (const itemPath of itemPaths) {
    const item = validateRootPath(root, itemPath);
    if (item.isProtected) throw new Error(getProtectedReason(item.relativePath));
    if (!item.relativePath) throw new Error("The library source root cannot be moved");
    if (!fs.existsSync(item.resolvedPath)) throw new Error(`${itemPath} does not exist`);

    const relativeToItem = path.relative(item.resolvedPath, destination.resolvedPath);
    if (relativeToItem === "" || (!relativeToItem.startsWith("..") && !path.isAbsolute(relativeToItem))) {
      throw new Error("A folder cannot be moved into itself");
    }
  }

  for (const itemPath of itemPaths) {
    const item = validateRootPath(root, itemPath);
    const nextPath = getUniquePath(path.join(destination.resolvedPath, path.basename(item.resolvedPath)));
    fs.renameSync(item.resolvedPath, nextPath);
  }

  return { root };
};

export const moveToTrash = async (rootId: string, itemPaths: string[], deletedBy: string | null) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);
  ensureDirectory(getTrashItemsPath(root));

  const trashed: TrashRecord[] = [];
  for (const itemPath of itemPaths) {
    const item = validateRootPath(root, itemPath);
    if (item.isProtected) throw new Error(getProtectedReason(item.relativePath));
    if (!item.relativePath) throw new Error("The library source root cannot be deleted");
    if (!fs.existsSync(item.resolvedPath)) throw new Error(`${itemPath} does not exist`);

    const trashId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const itemDir = path.join(getTrashItemsPath(root), trashId);
    ensureDirectory(itemDir);

    const trashedPath = path.join(itemDir, path.basename(item.resolvedPath));
    fs.renameSync(item.resolvedPath, trashedPath);

    const record: TrashRecord = {
      trashId,
      rootId: root.sourceId,
      originalPath: item.resolvedPath,
      trashedPath,
      itemName: path.basename(item.resolvedPath),
      itemType: statSafe(trashedPath).isDirectory() ? "directory" : "file",
      deletedAt: new Date().toISOString(),
      deletedBy,
    };

    fs.writeFileSync(path.join(itemDir, TRASH_METADATA_FILE), JSON.stringify(record, null, 2), "utf8");
    trashed.push(record);
  }

  return { root, trashed };
};

export const listTrash = async (rootId: string) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");

  const itemsPath = getTrashItemsPath(root);
  if (!fs.existsSync(itemsPath)) {
    return { root, items: [] as Array<TrashRecord & { size: number }> };
  }

  const items = fs
    .readdirSync(itemsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadTrashRecord(root, entry.name))
    .map((record) => ({
      ...record,
      size: fs.existsSync(record.trashedPath) && statSafe(record.trashedPath).isFile() ? statSafe(record.trashedPath).size : 0,
    }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return { root, items };
};

export const restoreTrashItems = async (rootId: string, trashIds: string[]) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);

  const restored: Array<{ trashId: string; restoredPath: string; usedFallback: boolean }> = [];
  for (const trashId of trashIds) {
    const record = loadTrashRecord(root, trashId);
    if (!fs.existsSync(record.trashedPath)) {
      throw new Error(`Trash item ${record.itemName} is missing`);
    }

    const targetPath = getRestoreTargetPath(record);
    ensureDirectory(path.dirname(targetPath));
    fs.renameSync(record.trashedPath, targetPath);
    fs.rmSync(path.dirname(record.trashedPath), { recursive: true, force: true });
    restored.push({
      trashId,
      restoredPath: targetPath,
      usedFallback: targetPath !== record.originalPath,
    });
  }

  return { root, restored };
};

export const permanentlyDeleteTrashItems = async (rootId: string, trashIds: string[]) => {
  const root = await findManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  requireWritableRoot(root);

  for (const trashId of trashIds) {
    const itemDir = path.join(getTrashItemsPath(root), trashId);
    if (!fs.existsSync(itemDir)) {
      throw new Error("Trash entry not found");
    }
    fs.rmSync(itemDir, { recursive: true, force: true });
  }

  return { root };
};

