import { Router } from "express";
import multer from "multer";
import path from "path";
import { uploadFiles } from "../controllers/uploadController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), "data", "temp"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

router.post("/", authenticate, authorizeAdmin, upload.array("files"), uploadFiles);

export default router;
