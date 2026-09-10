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
  requestInvestmentTopUp,
  getInvestmentTopUps,
  approveInvestmentTopUp,
  rejectInvestmentTopUp,
  updateInvestmentFinancialsController,
  deleteInvestmentController,
  sendPayoutNotification,
  markInvestmentPayoutController,
  manualDeductController,
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

// Top-up workflow (must be declared before /:investmentId)
router.get("/top-ups", getInvestmentTopUps);
router.post("/top-ups/:topUpId/approve", requireRole(["admin", "invest_admin"]), approveInvestmentTopUp);
router.post("/top-ups/:topUpId/reject", requireRole(["admin", "invest_admin"]), rejectInvestmentTopUp);

router.get("/:investmentId", getInvestmentById);

// User investment management
router.post("/:investmentId/maturity-action", setMaturityAction);
router.put("/:investmentId/update-value", updateInvestmentValue);
router.post("/:investmentId/top-up", requestInvestmentTopUp);
router.post("/:investmentId/payouts/notify", sendPayoutNotification);
router.post("/:investmentId/payouts", markInvestmentPayoutController);
router.post("/:investmentId/deduct", manualDeductController);

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
