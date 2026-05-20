import { Router } from "express";
import { createBugReport } from "../controllers/reportController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate);
router.post("/", createBugReport);

export default router;
