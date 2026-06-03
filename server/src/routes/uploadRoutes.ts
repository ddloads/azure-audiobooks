import { Router, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { uploadFiles } from "../controllers/uploadController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";
import {
  isAllowedUploadFilename,
  MAX_UPLOAD_FILE_COUNT,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  sanitizeUploadedFilename,
} from "../utils/uploadSafety";

const router = Router();
const tempUploadDir = path.join(process.cwd(), "data", "temp");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    cb(null, tempUploadDir);
  },
  filename: (_req, file, cb) => {
    const safeOriginalName = sanitizeUploadedFilename(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeOriginalName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_UPLOAD_FILE_COUNT,
  },
  fileFilter: (_req, file, cb) => {
    try {
      const safeOriginalName = sanitizeUploadedFilename(file.originalname);
      if (!isAllowedUploadFilename(safeOriginalName)) {
        cb(new Error("Unsupported upload file type"));
        return;
      }
      cb(null, true);
    } catch (error) {
      cb(error instanceof Error ? error : new Error("Invalid upload filename"));
    }
  },
});

const handleUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.array("files")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const file of files) {
      fs.rmSync(file.path, { force: true });
    }

    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  });
};

router.post("/", authenticate, authorizeAdmin, handleUpload, uploadFiles);

export default router;
