import { Router } from "express";
import { startSession, updateSession, getUserStats, getAdminStats } from "../controllers/sessionController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate);
router.post("/",          startSession);
router.patch("/:id",      updateSession);
router.get("/stats/me",   getUserStats);
router.get("/stats/admin", authorizeAdmin, getAdminStats);

export default router;
