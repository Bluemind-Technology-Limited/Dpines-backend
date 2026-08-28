// Deduction Controller - Exposes admin deduction and direct operation endpoints

import { Router, Request, Response } from "express";
import deductionService from "./deduction.service";
import { asyncHandler } from "@/middlewares/async.middleware";
import { authenticate, adminOnly } from "@/middlewares/auth.middleware";

const router: Router = Router();

// POST /deductions/process - Admin: Process investment-to-loan deduction - Body: - { - "loanId": "loan_123", - "investmentId": "inv_456", - "amount": 50000, - "reason": "collection_on_default" - }
router.post(
  "/process",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, investmentId, amount, reason } = req.body;
    const adminId = (req as any).user?.id;

    if (!loanId || !investmentId || !amount) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: loanId, investmentId, amount",
      });
      return;
    }

    const result = await deductionService.adminProcessDeduction(
      loanId,
      investmentId,
      amount,
      adminId,
      reason
    );

    res.status(200).json(result);
  })
);

// POST /deductions/charge - Admin: Apply direct charge to loan - Body: - { - "loanId": "loan_123", - "amount": 5000, - "chargeType": "penalty", - "reason": "breach_of_covenant" - }
router.post(
  "/charge",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, amount, chargeType, reason } = req.body;
    const adminId = (req as any).user?.id;

    if (!loanId || !amount) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: loanId, amount",
      });
      return;
    }

    const result = await deductionService.adminApplyDirectCharge(
      loanId,
      amount,
      adminId,
      chargeType,
      reason
    );

    res.status(200).json(result);
  })
);

// POST /deductions/deposit - Admin: Manually deposit funds to loan - Body: - { - "loanId": "loan_123", - "amount": 100000, - "reason": "cash_payment_otc" - }
router.post(
  "/deposit",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, amount, reason } = req.body;
    const adminId = (req as any).user?.id;

    if (!loanId || !amount) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: loanId, amount",
      });
      return;
    }

    const result = await deductionService.adminDirectDeposit(
      loanId,
      amount,
      adminId,
      reason
    );

    res.status(200).json(result);
  })
);

// POST /deductions/withdraw - Admin: Manually withdraw funds from investment - Body: - { - "investmentId": "inv_456", - "amount": 75000, - "reason": "early_redemption_approved" - }
router.post(
  "/withdraw",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { investmentId, amount, reason } = req.body;
    const adminId = (req as any).user?.id;

    if (!investmentId || !amount) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: investmentId, amount",
      });
      return;
    }

    const result = await deductionService.adminDirectWithdrawal(
      investmentId,
      amount,
      adminId,
      reason
    );

    res.status(200).json(result);
  })
);

export default router;
