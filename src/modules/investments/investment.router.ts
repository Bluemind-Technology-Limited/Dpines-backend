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
  topUpInvestment,
  updateInvestmentFinancialsController,
  deleteInvestmentController,
} from "./investment.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

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
router.post("/:investmentId/top-up", topUpInvestment);

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

router.put(
  "/:investmentId/financials",
  requireRole(["admin", "invest_admin"]),
  updateInvestmentFinancialsController
);

router.delete(
  "/:investmentId",
  requireRole(["admin", "invest_admin"]),
  deleteInvestmentController
);

export default router;
