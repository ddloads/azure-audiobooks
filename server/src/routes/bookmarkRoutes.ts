import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { createBookmark, deleteBookmark, getBookmarks, listUserBookmarks, updateBookmark } from "../controllers/bookmarkController";

const router = Router();

router.get("/", authenticate, listUserBookmarks);
router.get("/:bookId", authenticate, getBookmarks);
router.post("/", authenticate, createBookmark);
router.patch("/:id", authenticate, updateBookmark);
router.delete("/:id", authenticate, deleteBookmark);

export default router;
