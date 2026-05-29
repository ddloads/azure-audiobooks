import { Router } from "express";
import { createBugReport, listBugReports, updateBugReport, deleteBugReport } from "../controllers/reportController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate);
router.post("/", createBugReport);
router.get("/admin", authorizeAdmin, listBugReports);
router.patch("/:id", authorizeAdmin, updateBugReport);
router.delete("/:id", authorizeAdmin, deleteBugReport);

export default router;
