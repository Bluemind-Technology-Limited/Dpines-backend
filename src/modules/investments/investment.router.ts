import { Router } from "express";
import {
  createInvestment,
  getInvestmentById,
  getUserInvestments,
  getAllInvestments,
  approveInvestment,
  rejectInvestment,
  setMaturityAction,
  updateInvestmentValue,
  getInvestmentStats,
  completeInvestment,
} from "./investment.controller";
import { verifySupabaseToken, requireAuth, requireRole } from "@/middlewares/auth.middleware";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// User routes
router.post("/", createInvestment);
router.get("/user/stats", getInvestmentStats);
router.get("/user/my-investments", getUserInvestments);
router.get("/:investmentId", getInvestmentById);

// User investment management
router.post("/:investmentId/maturity-action", setMaturityAction);
router.put("/:investmentId/update-value", updateInvestmentValue);

// Admin routes (require admin role)
router.get("/", requireRole(["admin", "invest_admin"]), getAllInvestments);
router.post(
  "/:investmentId/approve",
  requireRole(["admin", "invest_admin"]),
  approveInvestment
);
router.post(
  "/:investmentId/reject",
  requireRole(["admin", "invest_admin"]),
  rejectInvestment
);
router.post(
  "/:investmentId/complete",
  requireRole(["admin", "invest_admin"]),
  completeInvestment
);

export default router;
