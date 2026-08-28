import { Router } from "express";
import {
  getProfile,
  updateProfile,
  getDashboardStats,
  getUserById,
  getAllUsers,
  searchUsers,
  updateUserRole,
  getUsersStats,
} from "./user.controller";
import { verifySupabaseToken, requireAuth, requireRole } from "@/middlewares/auth.middleware";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// User routes
router.get("/me/profile", getProfile);
router.put("/me/profile", updateProfile);
router.get("/me/dashboard-stats", getDashboardStats);

// Admin routes
router.get("/", requireRole(["admin"]), getAllUsers);
router.get("/search", requireRole(["admin"]), searchUsers);
router.get("/stats", requireRole(["admin"]), getUsersStats);
router.get("/:userId", requireRole(["admin"]), getUserById);
router.put("/:userId/role", requireRole(["admin"]), updateUserRole);

export default router;
