import { Router } from "express";
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

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", authenticate, getMe);
router.patch("/me/email",    authenticate, updateMyEmail);
router.patch("/me/username", authenticate, updateMyUsername);
router.patch("/me/password", authenticate, updateMyPassword);
router.post("/pair", authenticate, createPairingCode);
router.post("/pair/redeem", redeemPairingCode);

export default router;
