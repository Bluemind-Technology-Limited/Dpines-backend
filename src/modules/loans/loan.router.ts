import { Router } from "express";
import {
  createLoan,
  getLoanById,
  getUserLoans,
  getAllLoans,
  approveLoan,
  rejectLoan,
  createLoanPayment,
  approveLoanPayment,
  rejectLoanPayment,
  processDeduction,
  getLoanStats,
  getPendingPayments,
  getLoanPayments,
} from "./loan.controller.js";
import { verifySupabaseToken, requireAuth, requireRole } from "../../middlewares/auth.middleware.js";

const router: Router = Router();

// Apply authentication middleware to all routes
router.use(verifySupabaseToken);
router.use(requireAuth);

// User routes
router.post("/", createLoan);
router.get("/user/stats", getLoanStats);
router.get("/user/my-loans", getUserLoans);
router.get("/payments/pending", requireRole(["admin", "loans_admin"]), getPendingPayments);
router.get("/:loanId/payments", getLoanPayments);
router.get("/:loanId", getLoanById);

// User payment routes
router.post("/:loanId/payments", createLoanPayment);

// Admin routes (require admin role)
router.get("/", requireRole(["admin", "loans_admin"]), getAllLoans);
router.post("/:loanId/approve", requireRole(["admin", "loans_admin"]), approveLoan);
router.post("/:loanId/reject", requireRole(["admin", "loans_admin"]), rejectLoan);

router.post(
  "/payments/:paymentId/approve",
  requireRole(["admin", "loans_admin"]),
  approveLoanPayment
);
router.post(
  "/payments/:paymentId/reject",
  requireRole(["admin", "loans_admin"]),
  rejectLoanPayment
);

router.post(
  "/:loanId/deduct",
  requireRole(["admin", "loans_admin"]),
  processDeduction
);

export default router;
