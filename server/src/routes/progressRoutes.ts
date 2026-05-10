import { Router } from "express";
import { getAllUserProgress, getProgress, updateProgress } from "../controllers/progressController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getAllUserProgress);
router.get("/:bookId", authenticate, getProgress);
router.post("/:bookId", authenticate, updateProgress);

export default router;
