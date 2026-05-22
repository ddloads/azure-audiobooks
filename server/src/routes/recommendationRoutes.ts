import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { getRecommendations } from "../controllers/recommendationController";

const router = Router();

router.get("/", authenticate, getRecommendations);

export default router;
