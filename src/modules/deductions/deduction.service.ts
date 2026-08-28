// Admin Manual Deduction & Direct Operations Service - Handles admin-initiated deductions and direct financial operations - Operations: - 1. adminProcessDeduction - Pull investment funds into loan (investment→loan) - 2. adminApplyDirectCharge - Apply charges manually to loans - 3. adminDirectDeposit - Manual loan payment deposit - 4. adminDirectWithdrawal - Manual investment withdrawal - All operations require admin ID for accountability and are fully logged

import prisma from "@/configs/database";
import { AppError } from "@/middlewares/error.middleware";
import { LedgerService } from "@/services/ledger.service";
import { AuditService } from "@/services/audit.service";

const ledgerService = new LedgerService();
const auditService = new AuditService();

interface DeductionResult {
  success: boolean;
  message: string;
  loanId: string;
  investmentId: string;
  deductionAmount: number;
  investmentRemainingValue: number;
  loanRemainingBalance: number;
}

interface DirectChargeResult {
  success: boolean;
  message: string;
  loanId: string;
  chargeAmount: number;
  totalFeesNow: number;
  reason: string;
}

interface DirectDepositResult {
  success: boolean;
  message: string;
  loanId: string;
  depositAmount: number;
  appliedToPrincipal: number;
  appliedToFees: number;
  loanRemainingBalance: number;
}

interface DirectWithdrawalResult {
  success: boolean;
  message: string;
  investmentId: string;
  withdrawalAmount: number;
  investmentRemainingValue: number;
}

export class DeductionService {
  // OPERATION 1: Admin Process Deduction - Pull investment funds directly into a loan to reduce principal - Use case: Automatic collection from investment to clear urgent loan obligations - @param loanId - Loan to receive deduction - @param investmentId - Investment to deduct from - @param amount - Amount to deduct - @param adminId - Admin performing operation - @param reason - Reason for deduction (e.g., "collection_on_default")
  async adminProcessDeduction(
    loanId: string,
    investmentId: string,
    amount: number,
    adminId: string,
    reason: string = "admin_deduction"
  ): Promise<DeductionResult> {
    try {
      // Validate inputs
      if (amount <= 0) {
        throw new AppError(400, "Deduction amount must be positive");
      }

      // Verify admin exists
      const admin = await prisma.userProfile.findUnique({
        where: { id: adminId },
      });
      if (!admin) {
        throw new AppError(404, "Admin user not found");
      }

      // Fetch loan
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });
      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Fetch investment
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });
      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      // Validate investment has sufficient funds
      const investmentCurrentValue = (investment.current_value as any) || 0;
      if (investmentCurrentValue < amount) {
        throw new AppError(
          400,
          `Investment only has ₦${investmentCurrentValue} available, cannot deduct ₦${amount}`
        );
      }

      // Verify investment belongs to loan user (same person)
      if (investment.user_id !== loan.user_id) {
        throw new AppError(
          400,
          "Investment and Loan must belong to same user"
        );
      }

      // Calculate new values
      const newInvestmentValue = investmentCurrentValue - amount;
      const loanPrincipalBalance = (loan.principal_balance as any) || 0;
      const newLoanBalance = Math.max(0, loanPrincipalBalance - amount);
      const appliedAmount = loanPrincipalBalance - newLoanBalance;

      // Update investment (reduce current_value)
      await prisma.investment.update({
        where: { id: investmentId },
        data: {
          current_value: newInvestmentValue,
        },
      });

      // Update loan (reduce principal_balance)
      await prisma.loan.update({
        where: { id: loanId },
        data: {
          principal_balance: newLoanBalance,
        },
      });

      // Log deduction to ledger (from investment perspective)
      await ledgerService.logTransaction({
        userId: loan.user_id,
        amount,
        type: "deduction",
        sourceId: investmentId,
        method: "admin_manual",
        description: `Admin deduction from investment to loan: ${reason}`,
        metadata: {
          loanId,
          investmentId,
          reason,
          adminId,
          investmentType: "withdrawal_for_deduction",
        },
      });

      // Log deposit to ledger (from loan perspective)
      await ledgerService.logTransaction({
        userId: loan.user_id,
        amount: appliedAmount,
        type: "deposit",
        sourceId: loanId,
        method: "admin_manual",
        description: `Admin manual deposit from investment deduction`,
        metadata: {
          investmentId,
          loanId,
          reason,
          adminId,
        },
      });

      // Audit the operation
      await auditService.logAction({
        adminId,
        action: "manual_adjustment",
        newValues: {
          investmentId,
          deductionAmount: amount,
          appliedToLoan: appliedAmount,
          investmentNewValue: newInvestmentValue,
          loanNewBalance: newLoanBalance,
          reason,
        },
      });

      return {
        success: true,
        message: `Successfully deducted ₦${amount} from investment to loan`,
        loanId,
        investmentId,
        deductionAmount: amount,
        investmentRemainingValue: newInvestmentValue,
        loanRemainingBalance: newLoanBalance,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to process deduction");
    }
  }

  // OPERATION 2: Admin Apply Direct Charge - Manually apply charges (fees) to a loan - Use case: Manual penalty charge for default or breach - @param loanId - Loan to charge - @param amount - Charge amount - @param adminId - Admin performing operation - @param chargeType - Type of charge (penalty, late_fee, admin_fee, etc.) - @param reason - Detailed reason for charge
  async adminApplyDirectCharge(
    loanId: string,
    amount: number,
    adminId: string,
    chargeType: "penalty" | "late_fee" | "admin_fee" | "breach_fee" | "other" = "other",
    reason: string = "manual_charge"
  ): Promise<DirectChargeResult> {
    try {
      // Validate inputs
      if (amount <= 0) {
        throw new AppError(400, "Charge amount must be positive");
      }

      // Verify admin exists
      const admin = await prisma.userProfile.findUnique({
        where: { id: adminId },
      });
      if (!admin) {
        throw new AppError(404, "Admin user not found");
      }

      // Fetch loan
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });
      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Calculate new default charge
      const currentFees = (loan.default_charge_accrued as any) || 0;
      const newTotalFees = currentFees + amount;

      // Update loan with new charge
      await prisma.loan.update({
        where: { id: loanId },
        data: {
          default_charge_accrued: newTotalFees,
        },
      });

      // Log charge to ledger
      await ledgerService.logTransaction({
        userId: loan.user_id,
        amount,
        type: "charge",
        sourceId: loanId,
        method: "admin_manual",
        description: `Admin applied ${chargeType} charge: ${reason}`,
        metadata: {
          chargeType,
          reason,
          adminId,
        },
      });

      // Audit the operation
      await auditService.logAction({
        adminId,
        action: "manual_adjustment",
        newValues: {
          chargeType,
          chargeAmount: amount,
          totalFeesNow: newTotalFees,
          reason,
        },
      });

      return {
        success: true,
        message: `Successfully applied ₦${amount} ${chargeType} charge`,
        loanId,
        chargeAmount: amount,
        totalFeesNow: newTotalFees,
        reason,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to apply charge");
    }
  }

  // OPERATION 3: Admin Direct Deposit - Manually deposit funds into a loan account (manual payment entry) - Use case: Cash payment received through alternative channel (OTC, branch) - @param loanId - Loan receiving deposit - @param amount - Deposit amount - @param adminId - Admin processing deposit - @param reason - Reason for manual deposit
  async adminDirectDeposit(
    loanId: string,
    amount: number,
    adminId: string,
    reason: string = "manual_deposit"
  ): Promise<DirectDepositResult> {
    try {
      // Validate inputs
      if (amount <= 0) {
        throw new AppError(400, "Deposit amount must be positive");
      }

      // Verify admin exists
      const admin = await prisma.userProfile.findUnique({
        where: { id: adminId },
      });
      if (!admin) {
        throw new AppError(404, "Admin user not found");
      }

      // Fetch loan
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });
      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Get current balances
      const currentPrincipal = (loan.principal_balance as any) || 0;
      const currentFees = (loan.default_charge_accrued as any) || 0;
      let remainingDeposit = amount;

      // Payment allocation order: Fees first → Principal second
      let appliedToFees = 0;
      let appliedToPrincipal = 0;

      if (currentFees > 0) {
        appliedToFees = Math.min(remainingDeposit, currentFees);
        remainingDeposit -= appliedToFees;
      }

      if (remainingDeposit > 0 && currentPrincipal > 0) {
        appliedToPrincipal = Math.min(remainingDeposit, currentPrincipal);
      }

      // Calculate new balances
      const newFees = currentFees - appliedToFees;
      const newPrincipal = currentPrincipal - appliedToPrincipal;

      // Update loan
      await prisma.loan.update({
        where: { id: loanId },
        data: {
          principal_balance: newPrincipal,
          default_charge_accrued: newFees,
        },
      });

      // Log deposit to ledger
      await ledgerService.logTransaction({
        userId: loan.user_id,
        amount,
        type: "deposit",
        sourceId: loanId,
        method: "admin_manual",
        description: `Admin manual deposit: ${reason}`,
        metadata: {
          appliedToFees,
          appliedToPrincipal,
          reason,
          adminId,
        },
      });

      // Audit the operation
      await auditService.logAction({
        adminId,
        action: "manual_adjustment",
        newValues: {
          depositAmount: amount,
          appliedToFees,
          appliedToPrincipal,
          newPrincipal,
          newFees,
          reason,
        },
      });

      return {
        success: true,
        message: `Successfully deposited ₦${amount} to loan account`,
        loanId,
        depositAmount: amount,
        appliedToFees,
        appliedToPrincipal,
        loanRemainingBalance: newPrincipal,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to process deposit");
    }
  }

  // OPERATION 4: Admin Direct Withdrawal - Manually withdraw funds from an investment account - Use case: Approved early withdrawal or emergency redemption - @param investmentId - Investment to withdraw from - @param amount - Withdrawal amount - @param adminId - Admin processing withdrawal - @param reason - Reason for withdrawal (early_redemption, emergency, etc.)
  async adminDirectWithdrawal(
    investmentId: string,
    amount: number,
    adminId: string,
    reason: string = "manual_withdrawal"
  ): Promise<DirectWithdrawalResult> {
    try {
      // Validate inputs
      if (amount <= 0) {
        throw new AppError(400, "Withdrawal amount must be positive");
      }

      // Verify admin exists
      const admin = await prisma.userProfile.findUnique({
        where: { id: adminId },
      });
      if (!admin) {
        throw new AppError(404, "Admin user not found");
      }

      // Fetch investment
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });
      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      // Validate sufficient funds
      const currentValue = (investment.current_value as any) || 0;
      if (currentValue < amount) {
        throw new AppError(
          400,
          `Investment only has ₦${currentValue} available, cannot withdraw ₦${amount}`
        );
      }

      // Calculate new value
      const newValue = currentValue - amount;

      // Update investment
      await prisma.investment.update({
        where: { id: investmentId },
        data: {
          current_value: newValue,
          // Mark as withdrawn if fully depleted
          ...(newValue <= 0 && { status: "withdrawn" as any }),
        },
      });

      // Log withdrawal to ledger
      await ledgerService.logTransaction({
        userId: investment.user_id,
        amount,
        type: "withdrawal",
        sourceId: investmentId,
        method: "admin_manual",
        description: `Admin manual withdrawal: ${reason}`,
        metadata: {
          reason,
          adminId,
          newValue,
        },
      });

      // Audit the operation
      await auditService.logAction({
        adminId,
        action: "manual_adjustment",
        newValues: {
          withdrawalAmount: amount,
          investmentNewValue: newValue,
          reason,
        },
      });

      return {
        success: true,
        message: `Successfully withdrew ₦${amount} from investment`,
        investmentId,
        withdrawalAmount: amount,
        investmentRemainingValue: newValue,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to process withdrawal");
    }
  }
}

export default new DeductionService();
