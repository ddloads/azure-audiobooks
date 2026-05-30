import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  logout,
  getMe,
  updateMyEmail,
  updateMyUsername,
  updateMyPassword,
  createPairingCode,
  redeemPairingCode,
} from "../controllers/authController";
import { authenticate } from "../middleware/authMiddleware";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many registrations from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", authenticate, getMe);
router.patch("/me/email",    authenticate, updateMyEmail);
router.patch("/me/username", authenticate, updateMyUsername);
router.patch("/me/password", authenticate, updateMyPassword);
router.post("/pair", authenticate, createPairingCode);
router.post("/pair/redeem", redeemPairingCode);

export default router;
