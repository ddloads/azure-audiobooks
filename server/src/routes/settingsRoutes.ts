import { Router } from "express";
import { getAppearanceSettingsHandler } from "../controllers/settingsController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.get("/appearance", authenticate, getAppearanceSettingsHandler);

export default router;
