import { Router } from "express";
import { createBugReport, listBugReports } from "../controllers/reportController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate);
router.post("/", createBugReport);
router.get("/admin", authorizeAdmin, listBugReports);

export default router;
