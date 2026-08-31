// Advanced Loan Payment Processing Service - Handles complex payment calculations including: - - Late fee calculations - - Payment allocation (interest → fees → principal) - - Partial payment rollover with compounded interest - - Marked payments tracking - - Next due date calculations - - Loan status management

import prisma from "../configs/database.js";
import { AppError } from "../middlewares/error.middleware.js";

type LoanStatus = "pending" | "active" | "completed" | "overdue" | "rejected";

interface PaymentCalculation {
  lateFeeDays: number;
  lateFee: number;
  monthlyInterest: number;
  interestPaid: number;
  feesPaid: number;
  principalReduction: number;
  newPrincipalBalance: number;
  newStatus: LoanStatus;
  nextDueDate: Date | null;
}

export class PaymentService {
  // Process partial payment rollover - If payment < total_due: extend loan term, accrue compounded interest
  async processPartialPaymentRollover(
    loanId: string,
    paymentAmount: number,
    monthlyInterest: number,
    totalDue: number
  ): Promise<{
    isPartial: boolean;
    rolledBalance: number;
    compoundedInterest: number;
    termExtension: number;
  }> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Check if this is a partial payment
      if (paymentAmount >= totalDue) {
        return {
          isPartial: false,
          rolledBalance: 0,
          compoundedInterest: 0,
          termExtension: 0,
        };
      }

      // Reject if payment < monthly interest
      if (paymentAmount < monthlyInterest) {
        throw new AppError(
          400,
          `Payment must be at least equal to the monthly interest (₦${Math.round(Number(monthlyInterest))})`
        );
      }

      // Calculate rolled balance (unpaid principal from this month)
      const principalDue = totalDue - monthlyInterest;
      const rolledBalance = principalDue - Math.max(0, paymentAmount - monthlyInterest);

      // monthly_rate = monthly_rate_percent / 100 (Prisma returns snake_case)
      const monthlyRate = Number((loan as any).interest_rate) / 100;
      const compoundedInterest = rolledBalance * monthlyRate;

      // Update loan for rollover
      const currentRolloverCount = (loan as any).rollover_count || 0;
      const newRolloverCount = currentRolloverCount + 1;
      const termExtension = 1; // Extend by 1 month for each partial payment

      await prisma.loan.update({
        where: { id: loanId },
        data: {
          rolled_balance: Number(rolledBalance),
          compounded_interest: Number((loan as any).compounded_interest || 0) + compoundedInterest,
          term_months: (loan as any).term_months + termExtension,
          last_rollover_date: new Date(),
          rollover_count: newRolloverCount,
        },
      });

      return {
        isPartial: true,
        rolledBalance,
        compoundedInterest,
        termExtension,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to process partial payment rollover");
    }
  }

  // Calculate total due for a payment period - Includes: monthly interest + principal + compounded interest on rolled balance
  calculateTotalDue(
    monthlyPayment: number,
    compoundedInterest: number = 0
  ): number {
    return monthlyPayment + compoundedInterest;
  }

  // Calculate late fee based on days overdue - Rule: 1% of monthly interest per day, max 7 days accrual
  calculateLateFee(
    monthlyInterest: number,
    paymentDueDate: Date,
    paymentDate: Date
  ): { lateDays: number; lateFee: number } {
    const daysDifference = Math.floor(
      (paymentDate.getTime() - paymentDueDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const lateDays = Math.max(0, daysDifference);
    // Max 7 days of charges
    const chargeableDays = Math.min(lateDays, 7);
    // 1% of monthly interest per day
    const lateFee = monthlyInterest * 0.01 * chargeableDays;

    return { lateDays, lateFee: Math.round(lateFee * 100) / 100 };
  }

  // Allocate payment amount across interest, fees, and principal - Priority: Interest → Late Fees → Principal
  allocatePayment(
    paymentAmount: number,
    monthlyInterest: number,
    lateFee: number
  ): {
    interestPaid: number;
    feesPaid: number;
    principalReduction: number;
  } {
    let remaining = paymentAmount;

    // First: Pay interest
    const interestPaid = Math.min(remaining, monthlyInterest);
    remaining -= interestPaid;

    // Second: Pay late fees
    const feesPaid = Math.min(remaining, lateFee);
    remaining -= feesPaid;

    // Third: Reduce principal
    const principalReduction = remaining;

    return {
      interestPaid: Math.round(interestPaid * 100) / 100,
      feesPaid: Math.round(feesPaid * 100) / 100,
      principalReduction: Math.round(principalReduction * 100) / 100,
    };
  }

  // Calculate monthly interest from principal and monthly rate
  calculateMonthlyInterest(principal: number, interestRate: number): number {
    const monthlyRate = interestRate / 100;
    return principal * monthlyRate;
  }

  // Calculate next due date - Find next unmarked payment month, set to first day of that month
  calculateNextDueDate(
    loan: any,
    markedPayments: number[],
    paymentMonth: number
  ): Date | null {
    // Mark current payment as processed
    const allMarked = [...markedPayments, paymentMonth];

    // Schedule is based on the loan start date (fall back to created_at for
    // legacy loans approved before start_date tracking existed).
    const baseDate = (loan as any).start_date ?? (loan as any).created_at;

    // Find next unmarked month
    for (let month = paymentMonth + 1; month <= (loan as any).term_months; month++) {
      if (!allMarked.includes(month)) {
        const nextDueDate = new Date(baseDate);
        nextDueDate.setMonth(nextDueDate.getMonth() + month);
        nextDueDate.setDate(1); // First day of month
        return nextDueDate;
      }
    }

    // All months paid
    return null;
  }

  // Comprehensive payment processing with all calculations
  async processLoanPayment(
    loanId: string,
    paymentAmount: number,
    paymentDate: Date,
    monthNumber: number
  ): Promise<PaymentCalculation> {
    try {
      // Get loan
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Loans that are overdue still need to receive payments — only block loans
      // that genuinely can't be paid (pending/unapproved, rejected, completed).
      if (!["active", "overdue"].includes((loan as any).status)) {
        const reason = (loan as any).status === "completed"
          ? "Loan has already been completed - no further payments can be approved"
          : `Loan cannot receive payments (current status: ${(loan as any).status})`;
        throw new AppError(400, reason);
      }

      // A loan must have a start date to compute its payment schedule. Loans
      // approved through older paths may be active with a null start_date —
      // fall back to created_at so payments can still be approved (the missing
      // start_date is healed in applyPaymentToLoan).
      const loanStartDate = (loan as any).start_date ?? (loan as any).created_at;
      if (!loanStartDate) {
        throw new AppError(400, "Loan has not been approved (missing start date)");
      }

      // Calculate monthly interest (Prisma returns snake_case field names)
      const monthlyInterest = this.calculateMonthlyInterest(
        Number((loan as any).principal_balance),
        Number((loan as any).interest_rate)
      );

      // Calculate total due including compounded interest from rollover
      const compoundedInterest = Number((loan as any).compounded_interest || 0);
      const totalDue = this.calculateTotalDue(monthlyInterest, compoundedInterest);

      // Check for partial payment and process rollover if needed
      if (paymentAmount < totalDue) {
        // This is a partial payment - trigger rollover processing
        await this.processPartialPaymentRollover(
          loanId,
          paymentAmount,
          monthlyInterest,
          totalDue
        );
      }

      // Calculate late fee if applicable
      const expectedDueDate = (loan as any).next_due_date || new Date();
      const { lateDays, lateFee } = this.calculateLateFee(
        monthlyInterest,
        expectedDueDate,
        paymentDate
      );

      // Allocate payment
      const { interestPaid, feesPaid, principalReduction } = this.allocatePayment(
        paymentAmount,
        monthlyInterest,
        lateFee
      );

      // Calculate new principal balance (ensure it doesn't go negative)
      const newPrincipalBalance = Math.max(
        0,
        Number((loan as any).principal_balance) - principalReduction
      );

      // Handle very small balance (rounding)
      const finalPrincipalBalance = newPrincipalBalance < 0.01 ? 0 : newPrincipalBalance;

      // Mark payment as processed
      const newMarkedPayments = Array.isArray((loan as any).marked_payments)
        ? [...(loan as any).marked_payments]
        : [];
      if (!newMarkedPayments.includes(monthNumber)) {
        newMarkedPayments.push(monthNumber);
      }

      // Calculate new status
      let newStatus: LoanStatus = (loan as any).status as LoanStatus;
      if (finalPrincipalBalance === 0) {
        newStatus = "completed";
      } else if (lateDays > 0) {
        newStatus = "overdue";
      }

      // Calculate next due date
      const nextDueDate = this.calculateNextDueDate(
        loan,
        newMarkedPayments,
        monthNumber
      );

      return {
        lateFeeDays: lateDays,
        lateFee,
        monthlyInterest,
        interestPaid,
        feesPaid,
        principalReduction,
        newPrincipalBalance: finalPrincipalBalance,
        newStatus,
        nextDueDate,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Payment processing failed");
    }
  }

  // Apply calculated payment to loan in database
  async applyPaymentToLoan(
    loanId: string,
    calculation: PaymentCalculation,
    monthNumber: number,
    _principalBefore: number
  ): Promise<any> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Mark current payment if not already marked
      const markedPayments = Array.isArray((loan as any).marked_payments)
        ? [...(loan as any).marked_payments]
        : [];
      if (!markedPayments.includes(monthNumber)) {
        markedPayments.push(monthNumber);
      }

      // Update loan with new values
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          principal_balance: calculation.newPrincipalBalance,
          // amount_paid = total money received (interest + fees + principal), so
          // the UI's "paid so far" / progress reflects the full installment.
          // NOTE: Number(...) is required — Prisma Decimal.valueOf() returns a
          // string, so Decimal + number would string-concatenate.
          amount_paid: Number((loan as any).amount_paid || 0) + calculation.interestPaid + calculation.feesPaid + calculation.principalReduction,
          default_charge_accrued:
            Number((loan as any).default_charge_accrued || 0) + calculation.feesPaid,
          status: calculation.newStatus as any,
          marked_payments: markedPayments,
          next_due_date: calculation.nextDueDate,
          last_payment_date: new Date(),
          // Heal missing start_date for legacy loans so future approvals work
          start_date: (loan as any).start_date ?? (loan as any).created_at,
        },
      });

      return updatedLoan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to apply payment to loan");
    }
  }
}

export const paymentService = new PaymentService();
