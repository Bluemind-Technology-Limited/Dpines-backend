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

// A loans_admin can onboard a member (create only). Browsing the member
// directory, editing profiles and changing access levels remain admin-only —
// the Loans admin UI intentionally has no member table.
const CAN_CREATE_MEMBERS = ["admin", "loans_admin"];

// User routes
router.get("/me/profile", getProfile);
router.put("/me/profile", updateProfile);
router.get("/me/dashboard-stats", getDashboardStats);

// Admin routes
router.post("/", requireRole(CAN_CREATE_MEMBERS), createUserByAdmin);
router.get("/", requireRole(["admin"]), getAllUsers);
router.get("/search", requireRole(["admin"]), searchUsers);
router.get("/stats", requireRole(["admin"]), getUsersStats);
router.get("/:userId", requireRole(["admin"]), getUserById);

// Profile edits stay admin-only: the endpoint accepts `role`, so exposing it to
// a loans_admin would allow privilege escalation.
router.put("/:userId", requireRole(["admin"]), updateUserProfileAdmin);

// Only a full admin may change an account's access level.
router.put("/:userId/role", requireRole(["admin"]), updateUserRole);

export default router;
