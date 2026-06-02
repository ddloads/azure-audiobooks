import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  downloadLatestMobileApp,
  getLatestMobileApp,
  publishMobileApp,
} from "../controllers/mobileAppController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

const tempDir = path.join(process.cwd(), "data", "temp");
fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^A-Za-z0-9._-]/g, "_")}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".apk")) {
      cb(new Error("Only .apk files are allowed"));
      return;
    }
    cb(null, true);
  },
});

router.get("/latest", getLatestMobileApp);
router.get("/latest.apk", downloadLatestMobileApp);
router.post(
  "/upload",
  authenticate,
  authorizeAdmin,
  upload.single("apk"),
  publishMobileApp,
);

export default router;
