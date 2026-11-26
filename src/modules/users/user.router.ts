import { Router } from "express";
import {
  getProfile,
  updateProfile,
  getDashboardStats,
  getUserById,
  getAllUsers,
  searchUsers,
  updateUserRole,
  updateUserProfileAdmin,
  getUsersStats,
  createUserByAdmin,
} from "./user.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// Full admins manage everything. A loans_admin can onboard members (create +
// read the directory) but must not be able to change access levels: the profile
// endpoint accepts `role`, so granting it freely would allow privilege
// escalation. Role changes stay on the dedicated admin-only route.
const CAN_MANAGE_MEMBERS = ["admin", "loans_admin"];

// User routes
router.get("/me/profile", getProfile);
router.put("/me/profile", updateProfile);
router.get("/me/dashboard-stats", getDashboardStats);

// Admin routes
router.post("/", requireRole(CAN_MANAGE_MEMBERS), createUserByAdmin);
router.get("/", requireRole(CAN_MANAGE_MEMBERS), getAllUsers);
router.get("/search", requireRole(CAN_MANAGE_MEMBERS), searchUsers);
router.get("/stats", requireRole(CAN_MANAGE_MEMBERS), getUsersStats);
router.get("/:userId", requireRole(CAN_MANAGE_MEMBERS), getUserById);

// Editing a member's details is allowed for the same roles, but the controller
// strips `role` for anyone who is not a full admin.
router.put("/:userId", requireRole(CAN_MANAGE_MEMBERS), updateUserProfileAdmin);

// Only a full admin may change an account's access level.
router.put("/:userId/role", requireRole(["admin"]), updateUserRole);

export default router;
