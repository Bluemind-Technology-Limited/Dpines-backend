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
  createUserByAdmin,
} from "./user.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// User routes
router.get("/me/profile", getProfile);
router.put("/me/profile", updateProfile);
router.get("/me/dashboard-stats", getDashboardStats);

// Admin routes
router.post("/", requireRole(["admin"]), createUserByAdmin);
router.get("/", requireRole(["admin"]), getAllUsers);
router.get("/search", requireRole(["admin"]), searchUsers);
router.get("/stats", requireRole(["admin"]), getUsersStats);
router.get("/:userId", requireRole(["admin"]), getUserById);
router.put("/:userId/role", requireRole(["admin"]), updateUserRole);

export default router;
