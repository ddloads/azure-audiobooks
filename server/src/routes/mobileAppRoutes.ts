import { Router } from "express";
import { downloadLatestMobileApp, getLatestMobileApp } from "../controllers/mobileAppController";

const router = Router();

router.get("/latest", getLatestMobileApp);
router.get("/latest.apk", downloadLatestMobileApp);

export default router;
