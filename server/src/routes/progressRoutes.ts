import { Router } from "express";
import { deleteProgress, getAllUserProgress, getFinishedBooks, getProgress, hideProgress, updateProgress } from "../controllers/progressController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getAllUserProgress);
router.get("/finished", authenticate, getFinishedBooks);
router.get("/:bookId", authenticate, getProgress);
router.post("/:bookId", authenticate, updateProgress);
router.post("/:bookId/hide", authenticate, hideProgress);
router.delete("/:bookId", authenticate, deleteProgress);

export default router;
