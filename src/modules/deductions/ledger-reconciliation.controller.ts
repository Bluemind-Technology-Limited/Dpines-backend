// Ledger Reconciliation Controller - Batch deduction auditing, reconciliation, and validation endpoints - Phase 7.2: Complete Ledger Tracking

import { Router, Request, Response } from "express";
import { ledgerReconciliationService } from "../../services/ledger-reconciliation.service.js";
import { asyncHandler } from "../../middlewares/async.middleware.js";
import { authenticate, adminOnly } from "../../middlewares/auth.middleware.js";
import { AppError } from "../../middlewares/error.middleware.js";
import prisma from "../../configs/prisma-wrapper.js";

const router: Router = Router();

// GET /api/deductions/ledger/history/:loanId - Get complete deduction history for a loan - Query params: - - limit: number (default 100, max 500) - - offset: number (default 0) - Response: - { - success: true, - data: { - deductions: DeductionHistoryEntry[], - total: number, - summary: { totalDeducted, averageDeduction, deductionCount } - } - }
router.get(
  "/ledger/history/:loanId",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role?.toLowerCase() || "user";
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!loanId) {
      throw new AppError(400, "Missing required parameter: loanId");
    }

    // Admin can view any loan's history, regular users can only view their own
    if (!["admin", "loans_admin"].includes(userRole)) {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: { user_id: true },
      });
      
      if (!loan || loan.user_id !== userId) {
        throw new AppError(403, "You do not have permission to view this loan's deduction history");
      }
    }

    const result = await ledgerReconciliationService.getDeductionHistory(
      loanId,
      limit,
      offset
    );

    res.status(200).json({
      success: true,
      message: "Deduction history retrieved",
      data: result,
    });
  })
);

// GET /api/deductions/ledger/investment-history/:investmentId - Get deduction history for a specific investment - Shows all times this investment was deducted from - Query params: - - limit: number (default 100, max 500) - Response: - { - success: true, - data: { - deductions: DeductionHistoryEntry[], - total: number, - totalDeducted: number, - avgDeductionSize: number - } - }
router.get(
  "/ledger/investment-history/:investmentId",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { investmentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    if (!investmentId) {
      throw new AppError(400, "Missing required parameter: investmentId");
    }

    const result = await ledgerReconciliationService.getInvestmentDeductionHistory(
      investmentId,
      limit
    );

    res.status(200).json({
      success: true,
      message: "Investment deduction history retrieved",
      data: result,
    });
  })
);

// GET /api/deductions/ledger/user-history/:userId - Get the full transaction
// ledger for a user (deposits, deductions, interest, rollovers, charges). Admins
// can view any user; a regular user can only view their own history.
router.get(
  "/ledger/user-history/:userId",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!userId) {
      throw new AppError(400, "Missing required parameter: userId");
    }

    const userRole = (req as any).user?.role?.toLowerCase() || "user";
    const requesterId = (req as any).user?.sub;
    const isAdmin = ["admin", "invest_admin", "loans_admin", "support"].includes(userRole);
    if (!isAdmin && requesterId !== userId) {
      throw new AppError(403, "You can only view your own transaction history");
    }

    const [transactions, total] = await Promise.all([
      prisma.transactionLedger.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.transactionLedger.count({ where: { user_id: userId } }),
    ]);

    res.status(200).json({
      success: true,
      message: "User transaction history retrieved",
      data: { transactions, total },
    });
  })
);

// POST /api/deductions/audit/validate-sequence - Validate a deduction sequence maintains FIFO order - Body: - { - "loanId": "loan_123", - "userId": "user_456", - "deductionSequence": [ - { "investmentId": "inv_001", "amount": 50000 }, - { "investmentId": "inv_002", "amount": 30000 } - ] - } - Response: - { - success: true, - data: { - valid: boolean, - totalDeduced: number, - deductionCount: number, - sequence: DeductionHistoryEntry[], - violations: string[], - timestamp: Date - } - }
router.post(
  "/audit/validate-sequence",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, userId, deductionSequence } = req.body;

    if (!loanId || !userId || !Array.isArray(deductionSequence)) {
      throw new AppError(
        400,
        "Missing required fields: loanId, userId, deductionSequence (array)"
      );
    }

    if (deductionSequence.length === 0) {
      throw new AppError(400, "Deduction sequence cannot be empty");
    }

    // Validate each deduction entry
    for (const deduction of deductionSequence) {
      if (!deduction.investmentId || typeof deduction.amount !== "number") {
        throw new AppError(
          400,
          "Each deduction must have investmentId and amount (number)"
        );
      }

      if (deduction.amount <= 0) {
        throw new AppError(400, "Deduction amounts must be positive");
      }
    }

    const result = await ledgerReconciliationService.validateDeductionSequence(
      loanId,
      userId,
      deductionSequence
    );

    res.status(200).json({
      success: result.valid,
      message: result.valid
        ? "Deduction sequence is valid - maintains FIFO order"
        : "Deduction sequence is invalid - violates FIFO order",
      data: result,
    });
  })
);

// POST /api/deductions/audit/reconcile - Reconcile deductions against ledger for a date range - Ensures all deductions are properly recorded and accounted for - Body: - { - "loanId": "loan_123", - "userId": "user_456", - "startDate": "2024-01-01T00:00:00Z", - "endDate": "2024-01-31T23:59:59Z" - } - Response: - { - success: true, - data: { - userId: string, - loanId: string, - startDate: Date, - endDate: Date, - totalDeductions: number, - deductionCount: number, - investmentsImpacted: string[], - reconciled: boolean, - discrepancies: string[] - } - }
router.post(
  "/audit/reconcile",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, userId, startDate, endDate } = req.body;

    if (!loanId || !userId || !startDate || !endDate) {
      throw new AppError(
        400,
        "Missing required fields: loanId, userId, startDate, endDate"
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, "Invalid date format for startDate or endDate");
    }

    if (start > end) {
      throw new AppError(400, "startDate must be before endDate");
    }

    const result = await ledgerReconciliationService.reconcileDeductionsForPeriod(
      loanId,
      userId,
      start,
      end
    );

    res.status(200).json({
      success: result.reconciled,
      message: result.reconciled
        ? "Deductions reconciled successfully - no discrepancies"
        : "Deductions reconciled - discrepancies found",
      data: result,
    });
  })
);

// GET /api/deductions/audit/summary/:loanId - Get comprehensive deduction summary statistics - Query params: - - userId: string (optional, for filtering) - Response: - { - success: true, - data: { - userId: string, - loanId: string, - totalDeducted: number, - averageDeduction: number, - minDeduction: number, - maxDeduction: number, - deductionCount: number, - investmentCount: number, - dateRange: { earliest: Date, latest: Date }, - topInvestmentDeducedFrom: { investmentId, totalDeducted, deductionCount } - } - }
router.get(
  "/audit/summary/:loanId",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const userId = req.query.userId as string;

    if (!loanId) {
      throw new AppError(400, "Missing required parameter: loanId");
    }

    if (!userId) {
      throw new AppError(400, "Missing required query parameter: userId");
    }

    const result = await ledgerReconciliationService.getDeductionSummary(
      userId,
      loanId
    );

    res.status(200).json({
      success: true,
      message: "Deduction summary retrieved",
      data: result,
    });
  })
);

// POST /api/deductions/audit/validate-integrity - Validate transactions for duplicates and orphaned entries - Body: - { - "userId": "user_456", - "loanId": "loan_123", - "type": "deduction" (optional, default "all") - } - Response: - { - success: true, - data: { - valid: boolean, - errors: string[], - warnings: string[], - duplicates: Array<{ transactionIds, similarity }>, - orphanedTransactions: string[] - } - }
router.post(
  "/audit/validate-integrity",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, loanId, type } = req.body;

    if (!userId || !loanId) {
      throw new AppError(
        400,
        "Missing required fields: userId, loanId"
      );
    }

    const validTypes = ["deduction", "all"];
    if (type && !validTypes.includes(type)) {
      throw new AppError(
        400,
        `Invalid type. Must be one of: ${validTypes.join(", ")}`
      );
    }

    const result = await ledgerReconciliationService.validateTransactionIntegrity(
      userId,
      loanId,
      type || "all"
    );

    res.status(200).json({
      success: result.valid,
      message: result.valid
        ? "Transaction integrity validated - no issues found"
        : "Transaction integrity issues detected",
      data: result,
    });
  })
);

// POST /api/deductions/audit/store-fifo-snapshot - Store FIFO queue snapshot for audit trail - Preserves state of investment queue at specific time for compliance - Body: - { - "borrowerId": "user_456", - "loanId": "loan_123", - "queueSnapshot": [ - { - "position": 0, - "investmentId": "inv_001", - "createdAt": "2024-01-01T00:00:00Z", - "currentValue": 500000, - "eligibleForDeduction": true - } - ], - "reason": "batch_deduction_collection" - } - Response: - { - success: true, - data: { - borrowerId: string, - loanId: string, - timestamp: Date, - queueSnapshot: Array, - reasonForSnapshot: string - } - }
router.post(
  "/audit/store-fifo-snapshot",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { borrowerId, loanId, queueSnapshot, reason } = req.body;

    if (!borrowerId || !loanId || !Array.isArray(queueSnapshot)) {
      throw new AppError(
        400,
        "Missing required fields: borrowerId, loanId, queueSnapshot (array)"
      );
    }

    if (queueSnapshot.length === 0) {
      throw new AppError(400, "Queue snapshot cannot be empty");
    }

    // Validate each snapshot entry
    for (const entry of queueSnapshot) {
      if (
        typeof entry.position !== "number" ||
        !entry.investmentId ||
        typeof entry.currentValue !== "number" ||
        typeof entry.eligibleForDeduction !== "boolean"
      ) {
        throw new AppError(
          400,
          "Each snapshot entry must have: position (number), investmentId, currentValue (number), eligibleForDeduction (boolean)"
        );
      }
    }

    const result = await ledgerReconciliationService.storeFifoQueueSnapshot(
      borrowerId,
      loanId,
      queueSnapshot,
      reason
    );

    res.status(200).json({
      success: true,
      message: "FIFO queue snapshot stored",
      data: result,
    });
  })
);

// GET /api/deductions/audit/fifo-history/:borrowerId/:loanId - Get FIFO queue history for audit trail - Retrieves historical snapshots of investment queue - Query params: - - limit: number (default 20, max 100) - Response: - { - success: true, - data: FifoQueueHistory[] - }
router.get(
  "/audit/fifo-history/:borrowerId/:loanId",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { borrowerId, loanId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!borrowerId || !loanId) {
      throw new AppError(
        400,
        "Missing required parameters: borrowerId, loanId"
      );
    }

    const result = await ledgerReconciliationService.getFifoQueueHistory(
      borrowerId,
      loanId,
      limit
    );

    res.status(200).json({
      success: true,
      message: "FIFO queue history retrieved",
      data: {
        borrowerId,
        loanId,
        snapshots: result,
        totalSnapshots: result.length,
      },
    });
  })
);

// POST /api/deductions/audit/batch-reconcile - Batch reconcile multiple loans/users - Returns reconciliation status for each - Body: - { - "reconciliations": [ - { - "loanId": "loan_123", - "userId": "user_456", - "startDate": "2024-01-01T00:00:00Z", - "endDate": "2024-01-31T23:59:59Z" - } - ] - } - Response: - { - success: boolean, - data: { - total: number, - reconciled: number, - discrepancies: number, - results: LedgerReconciliation[] - } - }
router.post(
  "/audit/batch-reconcile",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { reconciliations } = req.body;

    if (!Array.isArray(reconciliations) || reconciliations.length === 0) {
      throw new AppError(
        400,
        "Missing required field: reconciliations (non-empty array)"
      );
    }

    const results = [];
    let reconciledCount = 0;
    let discrepancyCount = 0;

    for (const recon of reconciliations) {
      const { loanId, userId, startDate, endDate } = recon;

      if (!loanId || !userId || !startDate || !endDate) {
        results.push({
          loanId,
          userId,
          success: false,
          error: "Missing required fields: loanId, userId, startDate, endDate",
        });
        continue;
      }

      try {
        const result = await ledgerReconciliationService.reconcileDeductionsForPeriod(
          loanId,
          userId,
          new Date(startDate),
          new Date(endDate)
        );

        results.push({
          ...result,
          success: result.reconciled,
        });

        if (result.reconciled) {
          reconciledCount++;
        } else {
          discrepancyCount++;
        }
      } catch (error) {
        results.push({
          loanId,
          userId,
          success: false,
          error: error instanceof AppError ? error.message : "Unknown error",
        });
      }
    }

    res.status(200).json({
      success: discrepancyCount === 0,
      message: `Batch reconciliation complete: ${reconciledCount} reconciled, ${discrepancyCount} with discrepancies`,
      data: {
        total: reconciliations.length,
        reconciled: reconciledCount,
        discrepancies: discrepancyCount,
        results,
      },
    });
  })
);

export default router;
