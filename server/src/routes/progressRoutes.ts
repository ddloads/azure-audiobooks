import { Router } from "express";
import { deleteProgress, getAllUserProgress, getProgress, updateProgress } from "../controllers/progressController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getAllUserProgress);
router.get("/:bookId", authenticate, getProgress);
router.post("/:bookId", authenticate, updateProgress);
router.delete("/:bookId", authenticate, deleteProgress);

export default router;
