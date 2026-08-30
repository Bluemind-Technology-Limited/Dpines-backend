// FIFO Deduction Validation Service - Phase 7.1 - Enforces First-In-First-Out (FIFO) ordering for investment deductions - Purpose: - When an investor has multiple investments and one loan, the system ensures - deductions occur in the order investments were created (oldest first). - This prevents unfair targeting of specific investments and ensures fairness. - Rules: - 1. Oldest investments deducted first (start_date ascending) - 2. Cannot skip valid investments to deduct from newer ones - 3. Must have sufficient funds in the deduction source - 4. Cannot deduct from investments with withdrawn/cancelled status - 5. All deductions logged with FIFO queue position

import prisma from "../configs/database.js";
import { AppError } from "../middlewares/error.middleware.js";

interface FifoQueueItem {
  position: number; // Queue order (1 = oldest/first)
  investmentId: string;
  investorId: string;
  currentValue: number;
  startDate: Date;
  termMonths: number;
  endDate: Date | null;
  status: string;
  eligibleForDeduction: boolean;
  reason?: string; // Why ineligible, if applicable
}

interface DeductionValidationResult {
  valid: boolean;
  investmentId: string;
  investorId: string;
  maxAllowedAmount: number; // Amount available without FIFO violation
  fifoQueuePosition: number; // Position in FIFO queue
  totalEligibleInvestments: number; // Count of deduction-eligible investments
  violatesOrder?: string; // If invalid, why it violates FIFO
}

interface BatchDeductionValidation {
  loanId: string;
  borrowerId: string;
  totalDeductionNeeded: number;
  fifoQueue: FifoQueueItem[]; // Ordered by FIFO
  validationResults: {
    canProceed: boolean;
    availableAmount: number; // Total available through FIFO order
    requiredDeductions: Array<{
      investmentId: string;
      position: number;
      recommendedAmount: number;
    }>;
    message: string;
  };
}

// FifoDeductionValidator - Validates deductions follow FIFO order
class FifoDeductionValidator {
  // Get FIFO queue for a borrower's investments - Returns investments ordered by creation date (oldest first)
  async getFifoQueue(
    borrowerId: string
  ): Promise<FifoQueueItem[]> {
    try {
      // Fetch all active investments for the borrower
      const investments = await (prisma.investment as any).findMany({
        where: {
          user_id: borrowerId,
          status: "active",
        },
        orderBy: {
          start_date: "asc", // Oldest first
        },
      });

      // Transform to FIFO queue items
      const queue: FifoQueueItem[] = investments.map((inv: any, index: number) => ({
        position: index + 1,
        investmentId: inv.id,
        investorId: borrowerId,
        currentValue: Number(inv.current_value) || 0,
        startDate: inv.start_date || new Date(),
        termMonths: inv.term_months || 0,
        endDate: inv.end_date,
        status: inv.status || "active",
        eligibleForDeduction:
          inv.status === "active" && (inv.current_value as any) > 0,
      }));

      return queue;
    } catch (error) {
      console.error("Failed to get FIFO queue:", error);
      throw new AppError(500, "Failed to retrieve deduction queue");
    }
  }

  // Validate a deduction against FIFO rules - Returns whether the deduction is allowed and why
  async validateDeduction(
    loanId: string,
    investmentId: string,
    amount: number,
    borrowerId: string
  ): Promise<DeductionValidationResult> {
    try {
      // Validate inputs
      if (amount <= 0) {
        throw new AppError(400, "Deduction amount must be positive");
      }

      // Fetch loan and verify borrower
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      if (loan.user_id !== borrowerId) {
        throw new AppError(400, "Loan does not belong to borrower");
      }

      // Fetch investment and verify eligibility
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.user_id !== borrowerId) {
        throw new AppError(400, "Investment does not belong to borrower");
      }

      // Get FIFO queue
      const queue = await this.getFifoQueue(borrowerId);

      // Find this investment's position in queue
      const position = queue.findIndex((q) => q.investmentId === investmentId);

      if (position === -1) {
        return {
          valid: false,
          investmentId,
          investorId: borrowerId,
          maxAllowedAmount: 0,
          fifoQueuePosition: -1,
          totalEligibleInvestments: queue.filter((q) => q.eligibleForDeduction)
            .length,
          violatesOrder: "Investment not found in FIFO queue",
        };
      }

      // Check all investments before this one are exhausted
      let violatesOrder: string | undefined;
      let maxAllowed = 0;

      for (let i = 0; i < position; i++) {
        const queueItem = queue[i];
        if (queueItem.eligibleForDeduction && queueItem.currentValue > 0) {
          violatesOrder = `Cannot deduct from investment at position ${position + 1} while investment at position ${i + 1} has ₦${queueItem.currentValue} available`;
          break;
        }
      }

      // If no violation, calculate max allowed
      if (!violatesOrder) {
        maxAllowed = Math.min(amount, (investment.current_value as any) || 0);
      }

      return {
        valid: !violatesOrder,
        investmentId,
        investorId: borrowerId,
        maxAllowedAmount: maxAllowed,
        fifoQueuePosition: position + 1,
        totalEligibleInvestments: queue.filter((q) => q.eligibleForDeduction)
          .length,
        violatesOrder,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to validate deduction");
    }
  }

  // Plan batch deductions following FIFO order - Returns recommended deduction sequence to meet total need
  async planFifoDeductions(
    loanId: string,
    borrowerId: string,
    totalNeeded: number
  ): Promise<BatchDeductionValidation> {
    try {
      // Validate inputs
      if (totalNeeded <= 0) {
        throw new AppError(400, "Total deduction needed must be positive");
      }

      // Fetch loan
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan || loan.user_id !== borrowerId) {
        throw new AppError(404, "Loan not found for borrower");
      }

      // Get FIFO queue
      const queue = await this.getFifoQueue(borrowerId);

      // Calculate deductions following FIFO
      const requiredDeductions: Array<{
        investmentId: string;
        position: number;
        recommendedAmount: number;
      }> = [];

      let remaining = totalNeeded;
      let totalAvailable = 0;

      for (const queueItem of queue) {
        if (!queueItem.eligibleForDeduction || queueItem.currentValue <= 0) {
          continue; // Skip ineligible investments
        }

        totalAvailable += queueItem.currentValue;

        if (remaining > 0) {
          const deductAmount = Math.min(remaining, queueItem.currentValue);
          requiredDeductions.push({
            investmentId: queueItem.investmentId,
            position: queueItem.position,
            recommendedAmount: deductAmount,
          });
          remaining -= deductAmount;
        }
      }

      const canProceed = remaining <= 0;

      return {
        loanId,
        borrowerId,
        totalDeductionNeeded: totalNeeded,
        fifoQueue: queue,
        validationResults: {
          canProceed,
          availableAmount: totalAvailable,
          requiredDeductions,
          message: canProceed
            ? `Can deduct ₦${totalNeeded} via ${requiredDeductions.length} investments`
            : `Only ₦${totalAvailable} available (need ₦${totalNeeded}), shortfall of ₦${totalNeeded - totalAvailable}`,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to plan FIFO deductions");
    }
  }

  // Execute planned FIFO deductions - Applies deductions in FIFO order until total is met
  async executeFifoDeductions(
    loanId: string,
    borrowerId: string,
    totalNeeded: number,
    adminId: string,
    reason: string = "fifo_collection"
  ): Promise<{
    success: boolean;
    totalDeducted: number;
    deductionsApplied: Array<{
      investmentId: string;
      amount: number;
      position: number;
    }>;
    message: string;
  }> {
    try {
      // Plan deductions
      const plan = await this.planFifoDeductions(
        loanId,
        borrowerId,
        totalNeeded
      );

      if (!plan.validationResults.canProceed) {
        throw new AppError(
          400,
          `Insufficient funds: ${plan.validationResults.message}`
        );
      }

      const deductionService = require("@/modules/deductions/deduction.service").default;
      const deductionsApplied: Array<{
        investmentId: string;
        amount: number;
        position: number;
      }> = [];

      let totalDeducted = 0;

      // Execute deductions in FIFO order
      for (const deduction of plan.validationResults.requiredDeductions) {
        try {
          await deductionService.adminProcessDeduction(
            loanId,
            deduction.investmentId,
            deduction.recommendedAmount,
            adminId,
            `${reason} - FIFO position ${deduction.position}`
          );

          deductionsApplied.push({
            investmentId: deduction.investmentId,
            amount: deduction.recommendedAmount,
            position: deduction.position,
          });

          totalDeducted += deduction.recommendedAmount;
        } catch (error) {
          console.error(
            `Failed to apply FIFO deduction for investment ${deduction.investmentId}:`,
            error
          );
          // Continue with other deductions
        }
      }

      return {
        success: totalDeducted >= totalNeeded,
        totalDeducted,
        deductionsApplied,
        message: `Successfully deducted ₦${totalDeducted} via FIFO from ${deductionsApplied.length} investments`,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to execute FIFO deductions");
    }
  }

  // Validate deduction sequence - Ensures a sequence of deductions maintains FIFO order
  async validateDeductionSequence(
    borrowerId: string,
    deductionSequence: Array<{
      investmentId: string;
      amount: number;
    }>
  ): Promise<{
    valid: boolean;
    violations: Array<{
      sequenceIndex: number;
      investmentId: string;
      reason: string;
    }>;
    totalDeducted: number;
  }> {
    try {
      const queue = await this.getFifoQueue(borrowerId);
      const violations: Array<{
        sequenceIndex: number;
        investmentId: string;
        reason: string;
      }> = [];

      let totalDeducted = 0;
      const investmentsDeducted = new Set<string>();

      for (let i = 0; i < deductionSequence.length; i++) {
        const { investmentId, amount } = deductionSequence[i];

        // Find investment in queue
        const queueIndex = queue.findIndex(
          (q) => q.investmentId === investmentId
        );

        if (queueIndex === -1) {
          violations.push({
            sequenceIndex: i,
            investmentId,
            reason: "Investment not found in FIFO queue",
          });
          continue;
        }

        // Check if earlier investments have been deducted
        for (let j = 0; j < queueIndex; j++) {
          if (
            !investmentsDeducted.has(queue[j].investmentId) &&
            queue[j].eligibleForDeduction &&
            queue[j].currentValue > 0
          ) {
            violations.push({
              sequenceIndex: i,
              investmentId,
              reason: `Earlier investment ${queue[j].investmentId} at position ${j + 1} has not been exhausted`,
            });
          }
        }

        investmentsDeducted.add(investmentId);
        totalDeducted += amount;
      }

      return {
        valid: violations.length === 0,
        violations,
        totalDeducted,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to validate deduction sequence");
    }
  }
}

export const fifoDeductionValidator = new FifoDeductionValidator();
