import { Router } from "express";
import { getAuthors } from "../controllers/authorController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticate, getAuthors);

export default router;
