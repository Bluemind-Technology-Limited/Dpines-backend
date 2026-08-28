import { Request, Response, Router } from "express";
import { fifoDeductionValidator } from "@/services/deduction-validator.service";
import { asyncHandler } from "@/middlewares/async.middleware";
import { verifySupabaseToken } from "@/middlewares/auth.middleware";
import { AppError } from "@/middlewares/error.middleware";

const router: any = Router();

// GET /api/deductions/fifo/queue/:loanId - Get FIFO queue for a loan (admin view) - Shows which investments will be deducted in order
router.get(
  "/fifo/queue/:loanId",
  asyncHandler(verifySupabaseToken),
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const borrowerId = (req as any).userId;

    if (!borrowerId) {
      throw new AppError(401, "Unauthorized");
    }

    const queue = await fifoDeductionValidator.getFifoQueue(borrowerId);

    res.status(200).json({
      success: true,
      message: "FIFO queue retrieved",
      data: {
        loanId,
        borrowerId,
        queue,
        totalEligible: queue.filter((q) => q.eligibleForDeduction).length,
        totalAvailable: queue
          .filter((q) => q.eligibleForDeduction)
          .reduce((sum, q) => sum + q.currentValue, 0),
      },
    });
  })
);

// POST /api/deductions/fifo/validate - Validate a deduction against FIFO rules - Body: {loanId, investmentId, amount, borrowerId}
router.post(
  "/fifo/validate",
  asyncHandler(verifySupabaseToken),
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, investmentId, amount, borrowerId } = req.body;

    // Validate required fields
    if (!loanId || !investmentId || !amount || !borrowerId) {
      throw new AppError(
        400,
        "Missing required fields: loanId, investmentId, amount, borrowerId"
      );
    }

    if (amount <= 0) {
      throw new AppError(400, "Amount must be positive");
    }

    const validation = await fifoDeductionValidator.validateDeduction(
      loanId,
      investmentId,
      amount,
      borrowerId
    );

    res.status(200).json({
      success: true,
      message: validation.valid
        ? "Deduction valid - follows FIFO order"
        : "Deduction invalid - violates FIFO order",
      data: validation,
    });
  })
);

// POST /api/deductions/fifo/plan - Plan FIFO deductions for a loan - Returns recommended deduction sequence to meet a total need - Body: {loanId, borrowerId, totalNeeded}
router.post(
  "/fifo/plan",
  asyncHandler(verifySupabaseToken),
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, borrowerId, totalNeeded } = req.body;

    // Validate required fields
    if (!loanId || !borrowerId || totalNeeded === undefined) {
      throw new AppError(
        400,
        "Missing required fields: loanId, borrowerId, totalNeeded"
      );
    }

    if (totalNeeded <= 0) {
      throw new AppError(400, "Total needed must be positive");
    }

    const plan = await fifoDeductionValidator.planFifoDeductions(
      loanId,
      borrowerId,
      totalNeeded
    );

    res.status(200).json({
      success: true,
      message: "FIFO deduction plan created",
      data: plan,
    });
  })
);

// POST /api/deductions/fifo/execute - Admin only - Execute FIFO deductions - Applies deductions in FIFO order until total is met - Body: {loanId, borrowerId, totalNeeded, reason}
router.post(
  "/fifo/execute",
  asyncHandler(verifySupabaseToken),
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, borrowerId, totalNeeded, reason } = req.body;
    const adminId = (req as any).userId;

    // Validate required fields
    if (!loanId || !borrowerId || totalNeeded === undefined) {
      throw new AppError(
        400,
        "Missing required fields: loanId, borrowerId, totalNeeded"
      );
    }

    if (totalNeeded <= 0) {
      throw new AppError(400, "Total needed must be positive");
    }

    if (!adminId) {
      throw new AppError(401, "Unauthorized");
    }

    // TODO: Add admin role verification (Phase 8)

    const result = await fifoDeductionValidator.executeFifoDeductions(
      loanId,
      borrowerId,
      totalNeeded,
      adminId,
      reason || "fifo_collection"
    );

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result,
    });
  })
);

// POST /api/deductions/fifo/validate-sequence - Validate a sequence of deductions maintains FIFO order - Body: {borrowerId, loanId, deductionSequence: [{investmentId, amount}]}
router.post(
  "/fifo/validate-sequence",
  asyncHandler(verifySupabaseToken),
  asyncHandler(async (req: Request, res: Response) => {
    const { borrowerId, loanId, deductionSequence } = req.body;

    // Validate required fields
    if (!borrowerId || !loanId || !Array.isArray(deductionSequence)) {
      throw new AppError(
        400,
        "Missing required fields: borrowerId, loanId, deductionSequence"
      );
    }

    if (deductionSequence.length === 0) {
      throw new AppError(400, "Deduction sequence cannot be empty");
    }

    const validation = await fifoDeductionValidator.validateDeductionSequence(
      borrowerId,
      deductionSequence
    );

    res.status(200).json({
      success: true,
      message: validation.valid
        ? "Deduction sequence is valid - maintains FIFO order"
        : "Deduction sequence is invalid - violates FIFO order",
      data: validation,
    });
  })
);

export default router;
