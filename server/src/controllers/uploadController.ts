import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { resolveWritableLibrarySource } from "../utils/libraryConfig";

const getSingleBodyValue = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const uploadFiles = async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const folderName = getSingleBodyValue(req.body.folderName);
    const requestedLibraryId = getSingleBodyValue(req.body.libraryId);

    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    if (!folderName) {
      res.status(400).json({ error: "folderName is required" });
      return;
    }

    if (!requestedLibraryId) {
      res.status(400).json({ error: "Select a library before uploading files" });
      return;
    }

    const libraryId = requestedLibraryId;
    const targetSource = await resolveWritableLibrarySource(libraryId);

    if (!targetSource) {
      res.status(400).json({ error: "No writable source path is configured for this library" });
      return;
    }

    const targetDir = path.join(targetSource.resolvedPath, folderName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    for (const file of files) {
      const targetPath = path.join(targetDir, file.originalname);
      fs.renameSync(file.path, targetPath);
    }

    res.json({ message: "Upload successful. Run a library scan to index the new files." });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
};
