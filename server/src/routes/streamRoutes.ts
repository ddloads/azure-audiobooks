import { Router } from "express";
import { streamAudio } from "../controllers/streamController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();
router.get("/file/:fileId", authenticate, streamAudio);

export default router;
