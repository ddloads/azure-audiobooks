import { Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import path from "path";
import { resolveWritableLibrarySource } from "../utils/libraryConfig";
import {
  resolveUploadedFileTarget,
  resolveUploadTargetDir,
  sanitizeUploadFolderName,
} from "../utils/uploadSafety";

const getSingleBodyValue = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const removeUploadedTempFiles = async (files: Express.Multer.File[] = []) => {
  await Promise.all(
    files.map((file) => fsp.rm(file.path, { force: true }).catch(() => undefined)),
  );
};

const moveAcrossFilesystems = async (sourcePath: string, targetPath: string) => {
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fsp.copyFile(sourcePath, targetPath);
    try {
      await fsp.rm(sourcePath, { force: true });
    } catch (cleanupError) {
      await fsp.rm(targetPath, { force: true }).catch(() => undefined);
      throw cleanupError;
    }
  }
};

export const uploadFiles = async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const folderName = getSingleBodyValue(req.body.folderName);
    const requestedLibraryId = getSingleBodyValue(req.body.libraryId);
    const badRequest = async (message: string) => {
      await removeUploadedTempFiles(files);
      res.status(400).json({ error: message });
    };

    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    if (!folderName) {
      await badRequest("folderName is required");
      return;
    }

    if (!requestedLibraryId) {
      await badRequest("Select a library before uploading files");
      return;
    }

    const libraryId = requestedLibraryId;
    const targetSource = await resolveWritableLibrarySource(libraryId);

    if (!targetSource) {
      await badRequest("No writable source path is configured for this library");
      return;
    }

    const targetDir = resolveUploadTargetDir(targetSource.resolvedPath, sanitizeUploadFolderName(folderName));
    const createdTargetDir = !fs.existsSync(targetDir);
    if (createdTargetDir) {
      await fsp.mkdir(targetDir, { recursive: true });
    }

    const targets = files.map((file) => ({
      file,
      targetPath: resolveUploadedFileTarget(targetSource.resolvedPath, targetDir, file.originalname),
    }));
    const targetKeys = new Set<string>();
    for (const { targetPath } of targets) {
      const key = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
      if (targetKeys.has(key) || fs.existsSync(targetPath)) {
        throw new Error(`A file named ${path.basename(targetPath)} already exists`);
      }
      targetKeys.add(key);
    }

    const staged: Array<{ stagePath: string; targetPath: string }> = [];
    const committed: string[] = [];
    try {
      for (const { file, targetPath } of targets) {
        const stagePath = path.join(targetDir, `.azure-upload-${crypto.randomUUID()}-${path.basename(targetPath)}`);
        await moveAcrossFilesystems(file.path, stagePath);
        staged.push({ stagePath, targetPath });
      }

      for (const { stagePath, targetPath } of staged) {
        await fsp.copyFile(stagePath, targetPath, fs.constants.COPYFILE_EXCL);
        committed.push(targetPath);
        await fsp.rm(stagePath, { force: true });
      }
    } catch (error) {
      await Promise.all([
        ...staged.map(({ stagePath }) => fsp.rm(stagePath, { force: true }).catch(() => undefined)),
        ...committed.map((targetPath) => fsp.rm(targetPath, { force: true }).catch(() => undefined)),
      ]);
      throw error;
    }

    if (createdTargetDir && (await fsp.readdir(targetDir)).length === 0) {
      await fsp.rmdir(targetDir).catch(() => undefined);
    }

    res.json({ message: "Upload successful. Run a library scan to index the new files." });
  } catch (error) {
    await removeUploadedTempFiles(req.files as Express.Multer.File[] | undefined);
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  }
};
