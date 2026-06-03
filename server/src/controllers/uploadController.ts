import { Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
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
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    for (const file of files) {
      const targetPath = resolveUploadedFileTarget(targetSource.resolvedPath, targetDir, file.originalname);
      fs.renameSync(file.path, targetPath);
    }

    res.json({ message: "Upload successful. Run a library scan to index the new files." });
  } catch (error) {
    await removeUploadedTempFiles(req.files as Express.Multer.File[] | undefined);
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  }
};
