import { Router } from "express";
import { register, login, logout, getMe, createPairingCode, redeemPairingCode } from "../controllers/authController";
import { authenticate } from "../middleware/authMiddleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", authenticate, getMe);
router.post("/pair", authenticate, createPairingCode);
router.post("/pair/redeem", redeemPairingCode);

export default router;
