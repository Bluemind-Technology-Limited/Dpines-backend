import { Router, type Router as ExpressRouter } from "express";
import {
  generateOTP,
  verifyOTP,
  getProfile,
  updateProfile,
  changePassword,
  resetPassword,
} from "./auth.controller.js";
import { verifySupabaseToken, requireAuth } from "../../middlewares/auth.middleware.js";

const router: ExpressRouter = Router();

// Public routes
router.post("/otp/generate", generateOTP);
router.post("/otp/verify", verifyOTP);
router.post("/reset-password", resetPassword);

// Protected routes
router.use(verifySupabaseToken);
router.use(requireAuth);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.post("/change-password", changePassword);

export default router;
