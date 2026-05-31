import { Router } from "express";
import { startSession, updateSession, getUserStats, getUserSessions, getAdminStats, listAdminSessions } from "../controllers/sessionController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate);
router.post("/",          startSession);
router.post("/:id",       updateSession);
router.patch("/:id",      updateSession);
router.get("/me",         getUserSessions);
router.get("/stats/me",   getUserStats);
router.get("/stats/admin", authorizeAdmin, getAdminStats);
router.get("/admin/all",  authorizeAdmin, listAdminSessions);

export default router;
