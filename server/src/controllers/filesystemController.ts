import { Response } from "express";
import { requestLibraryScan } from "../lib/scanJobPool";
import { createLogger } from "../lib/logger";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  createFolder,
  getManagedRootById,
  listManagedRoots,
  listTrash,
  listTree,
  movePaths,
  moveToTrash,
  permanentlyDeleteTrashItems,
  previewOperation,
  renamePath,
  restoreTrashItems,
} from "../utils/fileManager";

const fileManagerLogger = createLogger("file-manager");

const getString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const queueRootRescan = async (rootId: string) => {
  const root = await getManagedRootById(rootId);
  if (!root) throw new Error("Library root not found");
  const scanRequest = await requestLibraryScan(root.libraryId, "filesystem");
  return { root, scanRequest };
};

export const listFilesystemRoots = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const roots = await listManagedRoots();
    res.json({ roots });
  } catch (error) {
    console.error("List filesystem roots error:", error);
    res.status(500).json({ error: "Failed to load filesystem roots" });
  }
};

export const browseFilesystemTree = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.query.rootId);
    if (!rootId) {
      res.status(400).json({ error: "rootId is required" });
      return;
    }

    const result = await listTree(rootId, getString(req.query.path) || null);
    res.json(result);
  } catch (error) {
    console.error("Browse filesystem tree error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to browse files" });
  }
};

export const previewFilesystemOperation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const paths = getStringArray(req.body?.paths);
    if (!rootId || paths.length === 0) {
      res.status(400).json({ error: "rootId and paths are required" });
      return;
    }

    const preview = await previewOperation(rootId, paths);
    res.json(preview);
  } catch (error) {
    console.error("Preview filesystem operation error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to preview operation" });
  }
};

export const createFilesystemFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const parentPath = getString(req.body?.parentPath);
    const folderName = getString(req.body?.folderName);
    if (!rootId || !parentPath || !folderName) {
      res.status(400).json({ error: "rootId, parentPath, and folderName are required" });
      return;
    }

    const result = await createFolder(rootId, parentPath, folderName);
    const { scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.info("Folder created", {
      rootId,
      libraryId: result.root.libraryId,
      parentPath,
      folderName,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.status(201).json({ path: result.targetPath, scanStatus: scanRequest.status, scanJobId: scanRequest.jobId });
  } catch (error) {
    console.error("Create filesystem folder error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create folder" });
  }
};

export const renameFilesystemItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const itemPath = getString(req.body?.itemPath);
    const nextName = getString(req.body?.nextName);
    if (!rootId || !itemPath || !nextName) {
      res.status(400).json({ error: "rootId, itemPath, and nextName are required" });
      return;
    }

    const result = await renamePath(rootId, itemPath, nextName);
    const { scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.info("Path renamed", {
      rootId,
      libraryId: result.root.libraryId,
      itemPath,
      nextName,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.json({ path: result.nextPath, scanStatus: scanRequest.status, scanJobId: scanRequest.jobId });
  } catch (error) {
    console.error("Rename filesystem item error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to rename item" });
  }
};

export const moveFilesystemItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const itemPaths = getStringArray(req.body?.itemPaths);
    const destinationPath = getString(req.body?.destinationPath);
    if (!rootId || itemPaths.length === 0 || !destinationPath) {
      res.status(400).json({ error: "rootId, itemPaths, and destinationPath are required" });
      return;
    }

    const result = await movePaths(rootId, itemPaths, destinationPath);
    const { scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.info("Paths moved", {
      rootId,
      libraryId: result.root.libraryId,
      itemCount: itemPaths.length,
      destinationPath,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.json({ scanStatus: scanRequest.status, scanJobId: scanRequest.jobId });
  } catch (error) {
    console.error("Move filesystem items error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to move items" });
  }
};

export const deleteFilesystemItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const itemPaths = getStringArray(req.body?.itemPaths);
    if (!rootId || itemPaths.length === 0) {
      res.status(400).json({ error: "rootId and itemPaths are required" });
      return;
    }

    const result = await moveToTrash(rootId, itemPaths, req.user?.userId ?? null);
    const { scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.warn("Paths moved to trash", {
      rootId,
      libraryId: result.root.libraryId,
      itemCount: itemPaths.length,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.json({ trashed: result.trashed, scanStatus: scanRequest.status, scanJobId: scanRequest.jobId });
  } catch (error) {
    console.error("Delete filesystem items error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to delete items" });
  }
};

export const listFilesystemTrash = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.query.rootId);
    if (!rootId) {
      res.status(400).json({ error: "rootId is required" });
      return;
    }

    const result = await listTrash(rootId);
    res.json(result);
  } catch (error) {
    console.error("List filesystem trash error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to load trash" });
  }
};

export const restoreFilesystemTrash = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const trashIds = getStringArray(req.body?.trashIds);
    if (!rootId || trashIds.length === 0) {
      res.status(400).json({ error: "rootId and trashIds are required" });
      return;
    }

    const result = await restoreTrashItems(rootId, trashIds);
    const { scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.info("Trash restored", {
      rootId,
      libraryId: result.root.libraryId,
      trashIds,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.json({ restored: result.restored, scanStatus: scanRequest.status, scanJobId: scanRequest.jobId });
  } catch (error) {
    console.error("Restore filesystem trash error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to restore trash items" });
  }
};

export const permanentlyDeleteFilesystemTrash = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    const trashIds = getStringArray(req.body?.trashIds);
    if (!rootId || trashIds.length === 0) {
      res.status(400).json({ error: "rootId and trashIds are required" });
      return;
    }

    const result = await permanentlyDeleteTrashItems(rootId, trashIds);
    fileManagerLogger.warn("Trash permanently deleted", {
      rootId,
      libraryId: result.root.libraryId,
      trashIds,
      actorUserId: req.user?.userId,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Permanent delete trash error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to permanently delete trash items" });
  }
};

export const rescanFilesystemRoot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rootId = getString(req.body?.rootId);
    if (!rootId) {
      res.status(400).json({ error: "rootId is required" });
      return;
    }

    const { root, scanRequest } = await queueRootRescan(rootId);
    fileManagerLogger.info("Filesystem root rescan requested", {
      rootId,
      libraryId: root.libraryId,
      actorUserId: req.user?.userId,
      scanStatus: scanRequest.status,
    });
    res.status(202).json({ message: scanRequest.message, status: scanRequest.status, jobId: scanRequest.jobId });
  } catch (error) {
    console.error("Filesystem rescan error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to queue rescan" });
  }
};
