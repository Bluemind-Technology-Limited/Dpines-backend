import prisma from "@/configs/database";
import { AppError } from "@/middlewares/error.middleware";
import type {
  Loan,
  LoanPayment,
} from "@/types";
import {
  calculateMonthlyPayment,
  calculateTotalInterest,
} from "@/lib/utils";
import { paymentService } from "@/services/payment.service";
import { ledgerService } from "@/services/ledger.service";
import { auditService } from "@/services/audit.service";
import notificationService from "@/modules/notifications/notification.service";
import { edgeFunctionService } from "@/services/edge-function.service";

export class LoanService {
  async createLoan(
    userId: string,
    amount: number,
    interestRate: number,
    termMonths: number,
    purpose?: string
  ): Promise<Loan> {
    try {
      // Verify user exists
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Calculate monthly payment and total interest
      const monthlyPayment = calculateMonthlyPayment(amount, interestRate, termMonths);
      const totalInterest = calculateTotalInterest(amount, monthlyPayment, termMonths);

      const loan = await prisma.loan.create({
        data: {
          user_id: userId,
          amount,
          interest_rate: interestRate,
          term_months: termMonths,
          monthly_payment: monthlyPayment,
          total_interest: totalInterest,
          purpose: purpose || "",
          principal_balance: amount,
          original_interest_rate: interestRate,
        },
      });

      return loan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create loan");
    }
  }

  async getLoanById(loanId: string): Promise<Loan | null> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          loan_payments: true,
          users: true,
        },
      });

      return loan as unknown as Loan | null;
    } catch (error) {
      throw new AppError(500, "Failed to fetch loan");
    }
  }

  async getUserLoans(userId: string, status?: string) {
    try {
      const where: any = { user_id: userId };
      if (status) {
        where.status = status;
      }

      const loans = await prisma.loan.findMany({
        where,
        include: {
          loan_payments: true,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return loans as unknown as Loan[];
    } catch (error) {
      throw new AppError(500, "Failed to fetch user loans");
    }
  }

  async getAllLoans(status?: string, skip: number = 0, take: number = 10) {
    try {
      const where: any = {};
      if (status) {
        where.status = status;
      }

      const [loans, total] = await Promise.all([
        prisma.loan.findMany({
          where,
          include: {
            users: true,
            loan_payments: true,
          },
          skip,
          take,
          orderBy: {
            created_at: "desc",
          },
        }),
        prisma.loan.count({ where }),
      ]);

      return { loans: loans as unknown as Loan[], total };
    } catch (error) {
      throw new AppError(500, "Failed to fetch loans");
    }
  }

  async approveLoan(loanId: string): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          users: true,
        },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      if ((loan as any).status !== "pending") {
        throw new AppError(400, "Loan is not in pending status");
      }

      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (loan as any).term_months);

      const nextDueDate = new Date();
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      nextDueDate.setDate(1); // Set to first day of next month

      const approvedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          status: "active" as any,
          start_date: startDate,
          end_date: endDate,
          next_due_date: nextDueDate,
        },
      });

      // Send loan approved email asynchronously using Edge Function
      if ((loan as any).users) {
        const user = (loan as any).users;
        edgeFunctionService.sendLoanApprovedEmail(
          user.email,
          user.first_name || "Borrower",
          Number(approvedLoan.amount),
          approvedLoan.id,
          Number(approvedLoan.monthly_payment),
          approvedLoan.term_months
        ).catch((err) => {
          console.error("Failed to trigger loan approved email edge function:", err);
        });
      }

      return approvedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to approve loan");
    }
  }

  async rejectLoan(loanId: string, rejectionReason: string): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      if ((loan as any).status !== "pending") {
        throw new AppError(400, "Loan is not in pending status");
      }

      const rejectedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          status: "rejected" as any,
          rejection_reason: rejectionReason,
        },
      });

      return rejectedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reject loan");
    }
  }

  async createLoanPayment(
    loanId: string,
    amount: number,
    paymentMethod: string,
    monthNumber: number,
    receiptUrl?: string
  ): Promise<LoanPayment> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const payment = await prisma.loanPayment.create({
        data: {
          loan_id: loanId,
          user_id: (loan as any).user_id,
          amount,
          payment_method: paymentMethod,
          payment_month: monthNumber,
          receipt_url: receiptUrl,
          status: "pending" as any,
        },
      });

      return payment as unknown as LoanPayment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create loan payment");
    }
  }

  async approveLoanPayment(paymentId: string): Promise<LoanPayment> {
    try {
      const payment = await prisma.loanPayment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new AppError(404, "Payment not found");
      }

      if ((payment as any).status !== "pending") {
        throw new AppError(400, "Payment is not in pending status");
      }

      // Get the loan
      const loan = await prisma.loan.findUnique({
        where: { id: (payment as any).loanId },
        include: {
          users: true,
        },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Process payment with advanced calculations
      const paymentCalculation = await paymentService.processLoanPayment(
        (payment as any).loanId,
        (payment as any).amount,
        (payment as any).paymentDate || new Date(),
        (payment as any).monthNumber
      );

      // Apply payment to loan
      await paymentService.applyPaymentToLoan(
        (payment as any).loanId,
        paymentCalculation,
        (payment as any).monthNumber,
        (loan as any).principalBalance
      );

      // Update payment status
      const approvedPayment = await prisma.loanPayment.update({
        where: { id: paymentId },
        data: {
          status: "approved" as any,
          late_days: paymentCalculation.lateFeeDays,
          default_fee: paymentCalculation.feesPaid,
          principal_reduction: paymentCalculation.principalReduction,
          pre_principal: (loan as any).principal_balance,
          post_principal: paymentCalculation.newPrincipalBalance,
          approved_at: new Date(),
        },
      });

      // Send repayment processed email asynchronously using Edge Function
      if ((loan as any).users) {
        const user = (loan as any).users;
        edgeFunctionService.sendRepaymentProcessedEmail(
          user.email,
          user.first_name || "Borrower",
          Number((payment as any).amount),
          (payment as any).monthNumber || 1,
          loan.id,
          Number(paymentCalculation.newPrincipalBalance)
        ).catch((err) => {
          console.error("Failed to trigger repayment processed email edge function:", err);
        });
      }

      // Log transaction: Payment received
      await ledgerService.logLoanPaymentReceived(
        (loan as any).user_id,
        (payment as any).loan_id,
        (payment as any).amount,
        ((payment as any).payment_method as any) || "bank_transfer"
      );

      // Log default charge if applicable
      if (paymentCalculation.lateFeeDays > 0 && paymentCalculation.feesPaid > 0) {
        await ledgerService.logDefaultCharge(
          (loan as any).user_id,
          (payment as any).loan_id,
          paymentCalculation.feesPaid,
          paymentCalculation.lateFeeDays
        );
      }

      // Send payment confirmation notification
      try {
        await notificationService.createNotification({
          userId: (loan as any).user_id,
          title: "Loan Payment Confirmed",
          message: `Your payment of ₦${(payment as any).amount} has been successfully processed.`,
          type: "loan_payment_received",
          channels: ["in_app", "email"],
          metadata: {
            loanId: (payment as any).loan_id,
            paymentAmount: (payment as any).amount,
            paymentDate: approvedPayment.approved_at,
            remainingBalance: paymentCalculation.newPrincipalBalance,
          },
        });
      } catch (notifError) {
        console.error("Failed to send payment confirmation notification:", notifError);
      }

      return approvedPayment as unknown as LoanPayment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to approve loan payment");
    }
  }

  async rejectLoanPayment(
    paymentId: string,
    rejectionReason: string
  ): Promise<LoanPayment> {
    try {
      const payment = await prisma.loanPayment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new AppError(404, "Payment not found");
      }

      const rejectedPayment = await prisma.loanPayment.update({
        where: { id: paymentId },
        data: {
          status: "rejected" as any,
          remarks: rejectionReason,
        },
      });

      return rejectedPayment as unknown as LoanPayment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reject loan payment");
    }
  }

  async processDeduction(loanId: string, amount: number) {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          users: true,
        },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Find active investments to deduct from (oldest first)
      const investments = await prisma.investment.findMany({
        where: {
          user_id: (loan as any).user_id,
          status: "active",
        },
        orderBy: {
          start_date: "asc",
        },
      });

      let remainingAmount = amount;

      for (const investment of investments) {
        if (remainingAmount <= 0) break;

        const deductAmount = Math.min(remainingAmount, Number((investment as any).current_value));

        // Log transaction: Investment deduction
        await ledgerService.logInvestmentDeduction(
          (loan as any).user_id,
          investment.id,
          loanId,
          deductAmount
        );

        // Update investment current value
        await prisma.investment.update({
          where: { id: investment.id },
          data: {
            current_value: Number((investment as any).current_value) - deductAmount,
          },
        });

        remainingAmount -= deductAmount;
      }

      // Update loan
      if (remainingAmount < amount) {
        const deductedAmount = amount - remainingAmount;
        const newPrincipalBalance = Math.max(0, Number((loan as any).principal_balance) - deductedAmount);

        const updatedLoan = await prisma.loan.update({
          where: { id: loanId },
          data: {
            principal_balance: newPrincipalBalance,
            amount_paid: (Number((loan as any).amount_paid) || 0) + deductedAmount,
            status:
              newPrincipalBalance === 0 ? ("completed" as any) : (loan as any).status,
          },
        });

        return {
          success: true,
          deductedAmount,
          remainingAmount,
          loan: updatedLoan,
        };
      }

      throw new AppError(
        400,
        "Insufficient investment balance for deduction"
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to process deduction");
    }
  }

  async getLoanStats(userId: string) {
    try {
      const loans = await prisma.loan.findMany({
        where: { user_id: userId },
      });

      const stats = {
        totalLoans: loans.length,
        activeLoan: loans.find((l) => (l as any).status === "active"),
        totalBorrowed: loans.reduce((sum, l) => sum + Number((l as any).amount), 0),
        totalPaid: loans.reduce((sum, l) => sum + (Number((l as any).amount_paid) || 0), 0),
        totalInterest: loans.reduce((sum, l) => sum + Number((l as any).total_interest), 0),
        completedLoans: loans.filter((l) => (l as any).status === "completed").length,
      };

      return stats;
    } catch (error) {
      throw new AppError(500, "Failed to fetch loan stats");
    }
  }

  // Admin: Update loan interest rate - For adjusting terms due to regulatory or exceptional circumstances
  async adminUpdateInterestRate(
    loanId: string,
    newInterestRate: number,
    adminId: string,
    reason: string
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldInterestRate = (loan as any).interest_rate;

      // Update loan
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          interest_rate: newInterestRate,
        },
      });

      // Log audit action
      await auditService.logLoanUpdate(
        adminId,
        loanId,
        (loan as any).user_id,
        { interest_rate: oldInterestRate },
        { interest_rate: newInterestRate },
        reason
      );

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update loan interest rate");
    }
  }

  // Admin: Update loan term - For extending or adjusting loan duration
  async adminUpdateLoanTerm(
    loanId: string,
    newTermMonths: number,
    adminId: string,
    reason: string
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldTermMonths = (loan as any).term_months;

      // Validate new term is reasonable (at least 1 month, max 360 months)
      if (newTermMonths < 1 || newTermMonths > 360) {
        throw new AppError(400, "Loan term must be between 1 and 360 months");
      }

      // Update loan
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          term_months: newTermMonths,
        },
      });

      // Log audit action
      await auditService.logLoanUpdate(
        adminId,
        loanId,
        (loan as any).user_id,
        { term_months: oldTermMonths },
        { term_months: newTermMonths },
        reason
      );

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update loan term");
    }
  }

  // Admin: Adjust principal balance - For write-offs, forgiveness, or corrections
  async adminAdjustPrincipalBalance(
    loanId: string,
    adjustmentAmount: number, // Positive = increase, Negative = decrease/forgive
    adminId: string,
    reason: string,
    adjustmentType: "write_off" | "forgiveness" | "correction" = "correction"
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldPrincipalBalance = (loan as any).principal_balance;
      const newPrincipalBalance = Math.max(0, oldPrincipalBalance + adjustmentAmount);

      // Update loan
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          principal_balance: newPrincipalBalance,
          status: newPrincipalBalance === 0 ? ("completed" as any) : (loan as any).status,
        },
      });

      // Log transaction if it's a forgiveness/write-off
      if (adjustmentAmount < 0) {
        await ledgerService.logTransaction({
          userId: (loan as any).user_id,
          type: "adjustment" as any,
          method: "admin_manual" as any,
          amount: Math.abs(adjustmentAmount),
          sourceId: loanId,
          description: `${adjustmentType} adjustment on loan principal`,
          metadata: {
            adjustmentType,
            reason,
            oldBalance: oldPrincipalBalance,
            newBalance: newPrincipalBalance,
          },
        });
      }

      // Log audit action
      await auditService.logManualAdjustment(
        adminId,
        (loan as any).user_id,
        loanId,
        { principal_balance: oldPrincipalBalance },
        { principal_balance: newPrincipalBalance },
        reason
      );

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to adjust principal balance");
    }
  }

  // Admin: Override loan status - For exceptional circumstances (approve overdue, mark as defaulted, etc)
  async adminOverrideLoanStatus(
    loanId: string,
    newStatus: "active" | "completed" | "overdue" | "defaulted",
    adminId: string,
    reason: string
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldStatus = (loan as any).status;

      // Update loan
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          status: newStatus as any,
        },
      });

      // Log audit action
      await auditService.logLoanStatusOverride(
        adminId,
        loanId,
        (loan as any).user_id,
        oldStatus,
        newStatus,
        reason
      );

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to override loan status");
    }
  }

  // Admin: Waive late fees - For exempting customers from late payment charges
  async adminWaiveLateFees(
    loanId: string,
    adminId: string,
    reason: string
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldDefaultCharges = (loan as any).default_charge_accrued || 0;

      // Clear late fees
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          default_charge_accrued: 0,
        },
      });

      // Log transaction - fee waiver
      if (oldDefaultCharges > 0) {
        await ledgerService.logTransaction({
          userId: (loan as any).user_id,
          type: "adjustment" as any,
          method: "admin_manual" as any,
          amount: oldDefaultCharges,
          sourceId: loanId,
          description: `Late fee waiver on loan`,
          metadata: {
            waiverReason: reason,
            feeWaived: oldDefaultCharges,
          },
        });
      }

      // Log audit action
      await auditService.logManualAdjustment(
        adminId,
        (loan as any).user_id,
        loanId,
        { default_charge_accrued: oldDefaultCharges },
        { default_charge_accrued: 0 },
        `Waived late fees: ${reason}`
      );

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to waive late fees");
    }
  }

  // Admin: Mark loan as in collections - For defaulted loans that need collection action
  async adminMarkForCollections(
    loanId: string,
    adminId: string,
    collectionNotes: string
  ): Promise<Loan> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      // Update loan status to defaulted and add collection metadata
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          status: "defaulted" as any,
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: (loan as any).user_id,
        action: "loan_status_override",
        oldValues: {
          status: (loan as any).status,
          collectionStatus: "none",
        },
        newValues: {
          status: "defaulted",
          collectionStatus: "referred_to_collections",
          collectionNotes,
        },
      });

      return updatedLoan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to mark loan for collections");
    }
  }

  // Apply late fee and send notification (Phase 5.3) - Called during payment processing when late fees are charged
  async applyLateFeeWithNotification(
    loanId: string,
    feeAmount: number,
    daysOverdue: number
  ): Promise<void> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        return; // Silently fail if loan not found
      }

      // Update loan with late fee
      const newTotalFees = ((loan as any).default_charge_accrued || 0) + feeAmount;
      await prisma.loan.update({
        where: { id: loanId },
        data: {
          default_charge_accrued: newTotalFees,
        },
      });

      // Log transaction
      await ledgerService.logDefaultCharge(
        (loan as any).user_id,
        loanId,
        feeAmount,
        daysOverdue
      );

      // Send notification
      try {
        await notificationService.notifyDefaultFeeCharged(
          loanId,
          feeAmount,
          daysOverdue,
          "1% per day"
        );
      } catch (notifError) {
        console.error("Failed to send late fee notification:", notifError);
      }
    } catch (error) {
      console.error("Failed to apply late fee with notification:", error);
    }
  }

  async getPendingPayments() {
    try {
      const payments = await prisma.loan_payments.findMany({
        where: { status: "pending" as any },
        include: {
          loans: {
            include: {
              users: true,
            },
          },
        },
        orderBy: {
          submitted_at: "desc",
        },
      });
      return payments;
    } catch (error) {
      throw new AppError(500, "Failed to fetch pending payments");
    }
  }

  async getLoanPayments(loanId: string) {
    try {
      const payments = await prisma.loan_payments.findMany({
        where: { loan_id: loanId },
        orderBy: { submitted_at: "desc" },
      });
      return payments;
    } catch (error) {
      throw new AppError(500, "Failed to fetch loan payments");
    }
  }

  async capitalizeAndRollOverLoan(
    loanId: string,
    feeAmount: number
  ): Promise<void> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const oldPrincipal = Number(loan.principal_balance !== undefined ? loan.principal_balance : loan.amount);
      const newPrincipal = oldPrincipal + feeAmount;
      const oldTerm = loan.term_months;
      const newTerm = oldTerm + 1;

      // Extend next due date by 1 month
      const currentDueDate = loan.next_due_date ? new Date(loan.next_due_date) : new Date();
      const newDueDate = new Date(currentDueDate);
      newDueDate.setMonth(newDueDate.getMonth() + 1);


      const oldRolledBalance = Number((loan as any).rolled_balance || 0);
      const newRolledBalance = oldRolledBalance + feeAmount;

      await prisma.loan.update({
        where: { id: loanId },
        data: {
          principal_balance: newPrincipal,
          term_months: newTerm,
          next_due_date: newDueDate,
          default_charge_accrued: 0,
          rolled_balance: newRolledBalance,
        },
      });

      // Log rollover in ledger
      await ledgerService.logRollover(
        (loan as any).user_id,
        loanId,
        feeAmount,
        "loan",
        `Capitalized default charge of ₦${feeAmount} into principal. Term extended to ${newTerm} months.`
      );

      // Create audit log
      await auditService.logAction({
        adminId: "00000000-0000-0000-0000-000000000000",
        targetUserId: (loan as any).user_id,
        action: "loan_updated",
        oldValues: {
          principal_balance: oldPrincipal,
          term_months: oldTerm,
          next_due_date: loan.next_due_date,
        },
        newValues: {
          principal_balance: newPrincipal,
          term_months: newTerm,
          next_due_date: newDueDate,
        },
      });

      // Send notification
      try {
        await notificationService.createNotification({
          userId: (loan as any).user_id,
          title: "Loan Capitalization & Rollover",
          message: `Your overdue penalty of ₦${feeAmount} has been capitalized into your principal balance. Your new principal is ₦${newPrincipal} and your due date has been extended.`,
          type: "system_alert",
          channels: ["in_app"],
        });
      } catch (notifErr) {
        console.error("Failed to send rollover notification:", notifErr);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to capitalize and rollover loan");
    }
  }

  async syncRolloverBalances(): Promise<void> {
    try {
      const activeLoans = await prisma.loan.findMany({
        where: {
          status: {
            in: ["active", "overdue"],
          },
        },
      });

      for (const loan of activeLoans) {
        const rollovers = await prisma.transaction_ledger.findMany({
          where: {
            source_id: loan.id,
            type: "rollover" as any,
          },
        });

        const totalRollovers = rollovers.reduce(
          (sum, r) => sum + Number(r.amount || 0),
          0
        );

        await prisma.loan.update({
          where: { id: loan.id },
          data: {
            rolled_balance: totalRollovers,
          },
        });
      }
      console.log("Successfully synchronized all loan rollover balances.");
    } catch (error) {
      console.error("Failed to sync rollover balances:", error);
    }
  }
}

export default new LoanService();

export const loanService = new LoanService();
