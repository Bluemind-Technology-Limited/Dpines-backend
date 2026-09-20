import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import type {
  Loan,
  LoanPayment,
} from "../../types/index.js";
import {
  calculateMonthlyPayment,
  calculateTotalInterest,
} from "../../lib/utils.js";
import { paymentService } from "../../services/payment.service.js";
import { ledgerService } from "../../services/ledger.service.js";
import { auditService } from "../../services/audit.service.js";
import notificationService from "../notifications/notification.service.js";
import { edgeFunctionService } from "../../services/edge-function.service.js";

const LOAN_STATUS_VALUES: readonly string[] = [
  "pending",
  "approved",
  "active",
  "overdue",
  "completed",
  "rejected",
];

const round2 = (value: number): number => Math.round(value * 100) / 100;

// Add whole calendar months to a date, preserving the day-of-month. This is the
// same convention the repayment schedule uses (month k falls on start + k).
const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Total interest implied by the repayment schedule: simulate a declining balance
// where each month charges interest on the outstanding principal and the fixed
// installment reduces it. This mirrors how a loan is priced at application time
// (the frontend's computeLoanSchedule), so editing the terms reproduces the same
// figure the borrower originally saw — never the flat `amount × rate × term`.
const computeScheduledTotalInterest = (
  principal: number,
  monthlyPayment: number,
  ratePercent: number,
  termMonths: number
): number => {
  const rate = ratePercent / 100;
  let balance = principal;
  let totalInterest = 0;

  for (let month = 1; month <= termMonths; month++) {
    const interest = round2(balance * rate);
    totalInterest += interest;

    if (month === termMonths) break;
    if (monthlyPayment < interest) break; // installment cannot even cover interest

    const principalReduction = Math.min(monthlyPayment - interest, balance);
    balance = round2(balance - principalReduction);
  }

  return round2(totalInterest);
};

const parseLoanDate = (value: unknown, field: string): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value as string);
  if (isNaN(parsed.getTime())) {
    throw new AppError(400, `Invalid ${field}`);
  }
  return parsed;
};

// Derive the next outstanding installment date: the first scheduled month that
// is neither already marked as paid nor already covered by an in-flight payment
// (recorded / pending / approved). Mirrors the schedule convention used by the
// frontend so the two never disagree.
async function computeLoanNextDueDate(
  loanId: string,
  startDate: Date | null,
  termMonths: number,
  markedPayments: unknown
): Promise<Date | null> {
  if (!startDate || !termMonths) return null;

  const marked = new Set<number>(
    Array.isArray(markedPayments) ? (markedPayments as number[]) : []
  );

  const inFlight = await prisma.loan_payments.findMany({
    where: {
      loan_id: loanId,
      payment_month: { not: null },
      status: { not: "rejected" },
    },
    select: { payment_month: true },
  });
  const spokenFor = new Set<number>(inFlight.map((p: any) => Number(p.payment_month)));

  for (let month = 1; month <= termMonths; month++) {
    if (!marked.has(month) && !spokenFor.has(month)) {
      return addMonths(startDate, month);
    }
  }
  return null;
}

export class LoanService {
  async createLoan(
    userId: string,
    amount: number,
    interestRate: number,
    termMonths: number,
    purpose?: string,
    customMonthlyPayment?: number,
    customTotalInterest?: number,
    // createdByUserId?: string (TODO: add this when database migration is done)
  ): Promise<Loan> {
    try {
      // Verify user exists
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Calculate monthly payment and total interest, respecting custom parameters if supplied
      const monthlyPayment = customMonthlyPayment || calculateMonthlyPayment(amount, interestRate, termMonths);
      const totalInterest = customTotalInterest !== undefined ? customTotalInterest : calculateTotalInterest(amount, monthlyPayment, termMonths);

      const loan = await prisma.loan.create({
        data: {
          user_id: userId,
          // created_by_id: createdByUserId || undefined,
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

      // Append-only history: every action is recorded, not just money movements.
      try {
        await ledgerService.logEvent(
          userId,
          loan.id,
          "status_change",
          `Loan application created — ₦${amount.toLocaleString()} at ${interestRate}% for ${termMonths} months`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log loan creation:", ledgerError);
      }

      return loan as unknown as Loan;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create loan");
    }
  }

  async getLoanById(loanId: string): Promise<Loan | null> {
    try {
      // Reflect any overdue penalties before returning the record so the loan's
      // stored balances always match reality (idempotent — at most once a day).
      await this.accrueOverdueCharges(loanId);

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

  // Accrue overdue penalties for a loan. Agreed rule:
  //   • The due date never moves — the loan stays overdue until it is paid.
  //   • ONE 7-day penalty cycle is charged per month, anchored to the due date's
  //     day-of-month (due on the 10th → the 7-day window 11th–17th; then the
  //     following month's 11th–17th; and so on).
  //   • Each cycle charges 7% of everything owed (initial principal + total
  //     interest + already-carried penalties), so it COMPOUNDS month over month.
  //   • The monthly repayment is re-derived upward so the enlarged balance still
  //     clears within the term.
  //   • Once the loan is past its final scheduled month, each further cycle rolls
  //     the term forward (month 6 → 7 → 8 …) until the loan is fully paid.
  //
  // `last_default_charge_date` stores the anniversary of the last charged cycle,
  // which makes catch-up exact and idempotent (a cycle is never charged twice).
  // Returns the total penalty charged during this call (0 when nothing was due).
  async accrueOverdueCharges(loanId: string): Promise<number> {
    try {
      const initial = await prisma.loan.findUnique({ where: { id: loanId } });
      if (!initial) return 0;
      const seed = initial as any;

      if (!["active", "overdue"].includes(seed.status)) return 0;
      if (Number(seed.principal_balance ?? seed.amount) <= 0) return 0;
      if (!seed.next_due_date) return 0;

      const now = new Date();
      const startOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );

      // Fixed anchor — the due date is never advanced by a default.
      const anchor = new Date(seed.next_due_date);

      // The first 7-day window (day after due → +7 days) must have elapsed.
      if (addDays(anchor, 7) > startOfToday) return 0;

      let lastCharged: Date | null = seed.last_default_charge_date
        ? new Date(seed.last_default_charge_date)
        : null;

      let applied = 0;
      let totalCharged = 0;
      const MAX_CYCLES = 240;

      for (let k = 0; k < MAX_CYCLES; k++) {
        const anniversary = addMonths(anchor, k);
        const windowEnd = addDays(anniversary, 7);
        if (windowEnd > startOfToday) break;
        if (lastCharged && anniversary <= lastCharged) continue;

        // Reload so each cycle compounds on the latest carried balance.
        const current = await prisma.loan.findUnique({ where: { id: loanId } });
        if (!current) return totalCharged;
        const rec = current as any;

        const amount = Number(rec.amount);
        const totalInterest = Number(rec.total_interest);
        const carried = Number(rec.rolled_balance || 0);
        const principal = Number(rec.principal_balance ?? amount);
        const rate = Number(rec.interest_rate);

        // One 7-day cycle = 7% of everything owed, compounded into the carried
        // balance so next month's cycle is charged on a larger amount.
        const cycleFee = round2((amount + totalInterest + carried) * 0.07);
        if (cycleFee <= 0) continue;
        const newRolled = round2(carried + cycleFee);

        // Roll the term forward only once we are past the final scheduled month.
        let newTerm = Number(rec.term_months);
        let newEndDate: Date | null = rec.end_date ? new Date(rec.end_date) : null;
        if (newEndDate && startOfToday > newEndDate) {
          newTerm = newTerm + 1;
          newEndDate = addMonths(newEndDate, 1);
        }
        newTerm = Math.max(1, newTerm);

        // Raise the monthly repayment so the enlarged balance still clears.
        const newMonthlyPayment = round2(
          calculateMonthlyPayment(principal + newRolled, rate, newTerm)
        );

        await prisma.loan.update({
          where: { id: loanId },
          data: {
            rolled_balance: newRolled,
            term_months: newTerm,
            ...(newEndDate && { end_date: newEndDate }),
            monthly_payment: newMonthlyPayment,
            status: "overdue" as any,
            last_default_charge_date: anniversary,
          },
        });

        try {
          await ledgerService.logRollover(
            rec.user_id,
            loanId,
            cycleFee,
            "loan",
            `Monthly default penalty of ₦${cycleFee.toLocaleString()} (7-day cycle ending ${windowEnd
              .toISOString()
              .slice(0, 10)}) capitalized into the carried balance.`
          );
        } catch (ledgerError) {
          console.error("[LEDGER] Failed to log default cycle:", ledgerError);
        }

        lastCharged = anniversary;
        totalCharged = round2(totalCharged + cycleFee);
        applied++;
      }

      if (applied > 0) {
        try {
          await notificationService.notifyDefaultFeeCharged(
            loanId,
            totalCharged,
            7,
            "1% per day × 7 days"
          );
        } catch (notifError) {
          console.error("[NOTIFY] Failed to send late fee notification:", notifError);
        }
      }

      return totalCharged;
    } catch (error) {
      console.error(`[ACCRUAL] Failed to accrue overdue charges for loan ${loanId}:`, error);
      return 0;
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
      // Follow the repayment-schedule convention: month k is due at
      // start_date + k months, preserving the day-of-month. Do NOT snap to the
      // 1st of the month — a loan starting on the 19th is due on the 19th.
      const endDate = addMonths(startDate, (loan as any).term_months);
      const nextDueDate = addMonths(startDate, 1);

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

      try {
        await ledgerService.logEvent(
          (loan as any).user_id,
          loanId,
          "status_change",
          `Loan approved — active ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log loan approval:", ledgerError);
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

      try {
        await ledgerService.logEvent(
          (loan as any).user_id,
          loanId,
          "status_change",
          `Loan rejected — ${rejectionReason || "no reason provided"}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log loan rejection:", ledgerError);
      }

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
          status: "recorded" as any,
        },
      });

      try {
        await ledgerService.logEvent(
          (loan as any).user_id,
          loanId,
          "payment_recorded",
          `Repayment of ₦${amount.toLocaleString()} recorded for month ${monthNumber} (${paymentMethod.replace(/_/g, " ")}) — awaiting approval`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log recorded payment:", ledgerError);
      }

      return payment as unknown as LoanPayment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create loan payment");
    }
  }

  async approveLoanPayment(paymentId: string): Promise<LoanPayment> {
    // ---- Up-front reads/validation (cheap failures don't open a transaction) ----
    const payment = await prisma.loanPayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      console.log(`[APPROVE PAYMENT] ✗ Payment ${paymentId} not found`);
      throw new AppError(404, "Payment not found");
    }

    if ((payment as any).status !== "recorded") {
      console.log(
        `[APPROVE PAYMENT] ✗ Payment ${paymentId} status is "${(payment as any).status}", expected "recorded"`
      );
      throw new AppError(400, "Payment is not in recorded status");
    }

    // loan_payments stores the installment as payment_month (not monthNumber)
    const paymentMonth = (payment as any).payment_month ?? (payment as any).monthNumber;
    const paymentMethod = (payment as any).payment_method || "bank_transfer";

    try {
      // -------------------------------------------------------------------
      // ONE transaction. The loan balances, the payment record, the ledger
      // entries and — for a contribution deduction — the investment debits all
      // commit together or not at all. Nothing can end up half-applied.
      // -------------------------------------------------------------------
      const { approvedPayment, calculation, loan } = await prisma.$transaction(
        async (tx: any) => {
          const loan = await tx.loans.findUnique({
            where: { id: (payment as any).loan_id },
            include: { users: true },
          });

          if (!loan) {
            throw new AppError(404, "Loan not found");
          }

          // Compute against the transactional snapshot, then apply.
          const calculation = await paymentService.processLoanPayment(
            (payment as any).loan_id,
            Number((payment as any).amount),
            new Date(),
            paymentMonth,
            tx
          );

          await paymentService.applyPaymentToLoan(
            (payment as any).loan_id,
            calculation,
            paymentMonth,
            Number((loan as any).principal_balance),
            tx
          );

          const approvedPayment = await tx.loan_payments.update({
            where: { id: paymentId },
            data: {
              status: "approved" as any,
              late_days: calculation.lateFeeDays,
              default_fee: calculation.feesPaid,
              principal_reduction: calculation.principalReduction,
              pre_principal: (loan as any).principal_balance,
              post_principal: calculation.newPrincipalBalance,
              approved_at: new Date(),
            },
          });

          // Ledger entry for the repayment, written inside the same transaction
          // so it can never drift from the balance change.
          await ledgerService.logLoanPaymentReceived(
            (loan as any).user_id,
            (payment as any).loan_id,
            Number((payment as any).amount),
            paymentMethod,
            tx
          );

          // Contribution deduction: debit the borrower's active investments in
          // the SAME transaction, so the loan and the investments cannot diverge.
          if (paymentMethod === "contribution_deduction") {
            await this.applyInvestmentDeduction(
              (payment as any).user_id,
              (payment as any).loan_id,
              Number((payment as any).amount),
              tx
            );
          }

          return { approvedPayment, calculation, loan };
        },
        { timeout: 20000 }
      );

      // -------------------------------------------------------------------
      // Side effects — AFTER the commit, never inside the transaction.
      // -------------------------------------------------------------------
      if ((loan as any).users) {
        const user = (loan as any).users;
        edgeFunctionService.sendRepaymentProcessedEmail(
          user.email,
          user.first_name || "Borrower",
          Number((payment as any).amount),
          (payment as any).payment_month || 1,
          loan.id,
          Number(calculation.newPrincipalBalance)
        ).catch((err) => {
          console.error("Failed to trigger repayment processed email edge function:", err);
        });
      }

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
            paymentDate: (approvedPayment as any).approved_at,
            remainingBalance: calculation.newPrincipalBalance,
          },
        });
      } catch (notifError) {
        console.error("Failed to send payment confirmation notification:", notifError);
      }

      console.log(`[APPROVE PAYMENT] ✓ Payment ${paymentId} approved successfully`);

      return approvedPayment as unknown as LoanPayment;
    } catch (error) {
      console.log(`[APPROVE PAYMENT] ✗ Failed for payment ${paymentId}:`, error instanceof AppError
        ? { statusCode: error.statusCode, message: error.message }
        : error);
      if (error instanceof AppError) throw error;
      console.error("[APPROVE LOAN PAYMENT] Unexpected error:", error);
      throw new AppError(500, `Failed to approve loan payment: ${(error as Error)?.message || "unknown error"}`);
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

      try {
        await ledgerService.logEvent(
          (payment as any).user_id,
          (payment as any).loan_id,
          "payment_rejected",
          `Repayment of ₦${Number((payment as any).amount).toLocaleString()} rejected — ${rejectionReason || "no reason provided"}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log rejected payment:", ledgerError);
      }

      return rejectedPayment as unknown as LoanPayment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reject loan payment");
    }
  }

  // Deduct from the borrower's active investments (FIFO, oldest first) to cover a
  // contribution-deduction payment, and record each deduction in the transaction
  // ledger (feeds the investment's transaction history).
  async applyInvestmentDeduction(userId: string, loanId: string, amount: number, client: any = prisma) {
    const investments = await client.investments.findMany({
      where: { user_id: userId, status: "active" },
      orderBy: { start_date: "asc" },
    });

    let remainingAmount = amount;
    const entries: { investmentId: string; amount: number }[] = [];

    for (const investment of investments) {
      if (remainingAmount <= 0) break;
      const currentValue = Number((investment as any).current_value);
      if (currentValue <= 0) continue;

      const deductAmount = Math.min(remainingAmount, currentValue);

      await ledgerService.logInvestmentDeduction(userId, investment.id, loanId, deductAmount, client);

      await client.investments.update({
        where: { id: investment.id },
        data: { current_value: currentValue - deductAmount },
      });

      remainingAmount -= deductAmount;
      entries.push({ investmentId: investment.id, amount: deductAmount });
    }

    if (entries.length === 0) {
      console.warn(`[APPROVE PAYMENT] No active investments to deduct for user ${userId} (amount ${amount})`);
    }

    return { deductedAmount: amount - remainingAmount, remainingAmount, entries };
  }

  async processDeduction(loanId: string, amount: number) {
    try {
      // One transaction: the investment debits, the loan update and the ledger
      // entries commit together or not at all.
      return await prisma.$transaction(async (tx: any) => {
        const loan = await tx.loans.findUnique({
          where: { id: loanId },
          include: {
            users: true,
          },
        });

        if (!loan) {
          throw new AppError(404, "Loan not found");
        }

        // Find active investments to deduct from (oldest first)
        const investments = await tx.investments.findMany({
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
            deductAmount,
            tx
          );

          // Update investment current value
          await tx.investments.update({
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

          const updatedLoan = await tx.loans.update({
            where: { id: loanId },
            data: {
              principal_balance: newPrincipalBalance,
              amount_paid: (Number((loan as any).amount_paid) || 0) + deductedAmount,
              status:
                newPrincipalBalance === 0 ? ("completed" as any) : (loan as any).status,
            },
          });

          // Loan-side record of the repayment (the investment-side deduction is
          // logged separately), so the loan ledger reflects the money received.
          await ledgerService.logTransaction({
            userId: (loan as any).user_id,
            amount: deductedAmount,
            type: "deposit",
            sourceId: loanId,
            method: "contribution_deduction",
            description: `Loan repayment of ₦${deductedAmount.toLocaleString()} via contribution deduction`,
          }, tx);

          return {
            success: true,
            deductedAmount,
            remainingAmount,
            loan: updatedLoan,
          };
        }

        throw new AppError(400, "Insufficient investment balance for deduction");
      }, { timeout: 20000 });
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
        activeLoan: loans.find((l: any) => (l as any).status === "active"),
        totalBorrowed: loans.reduce((sum: number, l: any) => sum + Number((l as any).amount), 0),
        totalPaid: loans.reduce((sum: number, l: any) => sum + (Number((l as any).amount_paid) || 0), 0),
        totalInterest: loans.reduce((sum: number, l: any) => sum + Number((l as any).total_interest), 0),
        completedLoans: loans.filter((l: any) => (l as any).status === "completed").length,
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
        where: { status: "recorded" as any },
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

  async getUserPendingPayments(userId: string) {
    try {
      const payments = await prisma.loan_payments.findMany({
        where: {
          status: "pending" as any,
          loans: {
            user_id: userId,
          },
        },
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

      const oldTerm = loan.term_months;
      const newTerm = oldTerm + 1;

      // Extend next due date by 1 month
      const currentDueDate = loan.next_due_date ? new Date(loan.next_due_date) : new Date();
      const newDueDate = new Date(currentDueDate);
      newDueDate.setMonth(newDueDate.getMonth() + 1);

      const oldRolledBalance = Number((loan as any).rolled_balance || 0);
      const newRolledBalance = oldRolledBalance + feeAmount;

      // The capitalized fee moves OUT of the accrued-penalty column and INTO the
      // carried balance. It is deliberately NOT added to principal_balance — that
      // would double-count it. The accrued column is reduced rather than zeroed
      // so unrelated fees are preserved.
      const oldAccruedFees = Number((loan as any).default_charge_accrued || 0);
      const newAccruedFees = Math.max(0, oldAccruedFees - feeAmount);

      // Re-derive the installment so the repayment reflects the larger amount
      // owed. Re-amortised over the remaining (pre-extension) term so defaulting
      // genuinely raises the monthly repayment, as the business requires.
      const paidPeriods = Array.isArray((loan as any).marked_payments)
        ? (loan as any).marked_payments.length
        : 0;
      const remainingForPayment = Math.max(1, oldTerm - paidPeriods);
      const principalForPayment =
        Number((loan as any).principal_balance ?? (loan as any).amount) + newRolledBalance;
      const newMonthlyPayment = round2(
        calculateMonthlyPayment(
          principalForPayment,
          Number((loan as any).interest_rate),
          remainingForPayment
        )
      );
      const newTotalInterest = computeScheduledTotalInterest(
        Number((loan as any).amount),
        newMonthlyPayment,
        Number((loan as any).interest_rate),
        newTerm
      );

      await prisma.loan.update({
        where: { id: loanId },
        data: {
          term_months: newTerm,
          next_due_date: newDueDate,
          default_charge_accrued: newAccruedFees,
          rolled_balance: newRolledBalance,
          monthly_payment: newMonthlyPayment,
          total_interest: newTotalInterest,
        },
      });

      // Log rollover in ledger
      await ledgerService.logRollover(
        (loan as any).user_id,
        loanId,
        feeAmount,
        "loan",
        `Capitalized default charge of ₦${feeAmount} into the carried balance. Term extended to ${newTerm} months.`
      );

      // Create audit log (system actor → the audit service resolves a real admin)
      await auditService.logAction({
        adminId: "system",
        targetUserId: (loan as any).user_id,
        action: "loan_updated",
        oldValues: {
          term_months: oldTerm,
          next_due_date: loan.next_due_date,
          rolled_balance: oldRolledBalance,
          default_charge_accrued: oldAccruedFees,
        },
        newValues: {
          term_months: newTerm,
          next_due_date: newDueDate,
          rolled_balance: newRolledBalance,
          default_charge_accrued: newAccruedFees,
          monthly_payment: newMonthlyPayment,
          total_interest: newTotalInterest,
        },
      });

      // Send notification
      try {
        await notificationService.createNotification({
          userId: (loan as any).user_id,
          title: "Loan Capitalization & Rollover",
          message: `Your overdue penalty of ₦${feeAmount} has been capitalized into your loan balance. Your monthly repayment is now ₦${newMonthlyPayment} and your due date has been extended.`,
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
          (sum: number, r: any) => sum + Number(r.amount || 0),
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

  async deleteLoan(loanId: string) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      throw new AppError(404, "Loan not found");
    }

    // Clean up ledger references so they don't dangle after deletion
    await prisma.transactionLedger.deleteMany({
      where: { source_id: loanId },
    });

    await prisma.loan.delete({
      where: { id: loanId },
    });

    return { id: loanId };
  }

  // Admin edit of a loan's financial record. The admin may change any field;
  // dependent values are then re-derived so the record stays consistent:
  //   start_date + term_months              → end_date
  //   amount + interest_rate + term_months  → monthly_payment + total_interest
  //   schedule + marked / in-flight months  → next_due_date
  // The edit is append-only: past ledger rows are never rewritten, but the change
  // is recorded as a `timeline_edit` event plus an audit entry for traceability.
  async updateLoanFinancials(loanId: string, updates: any, adminId?: string) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      throw new AppError(404, "Loan not found");
    }

    const stored = loan as any;
    const updatedData: any = {};

    // ---- status (validated against the loan_status enum) ----
    if (updates.status !== undefined && updates.status !== "") {
      if (!LOAN_STATUS_VALUES.includes(updates.status)) {
        throw new AppError(400, `Invalid loan status: ${updates.status}`);
      }
      updatedData.status = updates.status;
    }

    // ---- contract inputs ----
    const amountProvided = updates.amount !== undefined;
    const rateProvided = updates.interest_rate !== undefined;
    const termProvided = updates.term_months !== undefined;
    const startProvided = updates.start_date !== undefined;

    const newAmount = amountProvided ? Number(updates.amount) : Number(stored.amount);
    const newRate = rateProvided ? Number(updates.interest_rate) : Number(stored.interest_rate);
    const newTerm = termProvided ? Number(updates.term_months) : Number(stored.term_months);
    const newStartDate = startProvided
      ? parseLoanDate(updates.start_date, "start date")
      : stored.start_date
        ? new Date(stored.start_date)
        : null;

    // ---- outstanding principal ----
    let newPrincipal =
      updates.principal_balance !== undefined
        ? Number(updates.principal_balance)
        : Number(stored.principal_balance);
    const principalExplicitlyChanged =
      updates.principal_balance !== undefined &&
      Math.abs(Number(updates.principal_balance) - Number(stored.principal_balance)) > 0.005;
    // When the contract amount changes on an untouched loan (nothing repaid yet),
    // keep the outstanding balance in step unless the admin changed it on purpose.
    if (amountProvided && !principalExplicitlyChanged && Number(stored.amount_paid) === 0) {
      newPrincipal = newAmount;
    }
    updatedData.principal_balance = round2(Math.max(0, newPrincipal));

    // ---- timeline: end_date follows start_date + term_months ----
    if (startProvided) updatedData.start_date = newStartDate;
    if (termProvided) updatedData.term_months = newTerm;
    if (updates.end_date !== undefined && updates.end_date !== null && !startProvided && !termProvided) {
      updatedData.end_date = parseLoanDate(updates.end_date, "end date");
    } else if ((startProvided || termProvided) && newStartDate && newTerm) {
      updatedData.end_date = addMonths(newStartDate, newTerm);
    }

    // ---- contract outputs: monthly_payment + total_interest ----
    const contractChanged =
      (amountProvided && Math.abs(newAmount - Number(stored.amount)) > 0.005) ||
      (rateProvided && Math.abs(newRate - Number(stored.interest_rate)) > 0.005) ||
      (termProvided && newTerm !== Number(stored.term_months));

    const mpProvided = updates.monthly_payment !== undefined;
    const tiProvided = updates.total_interest !== undefined;
    const mpChanged =
      mpProvided && Math.abs(Number(updates.monthly_payment) - Number(stored.monthly_payment)) > 0.005;
    const tiChanged =
      tiProvided && Math.abs(Number(updates.total_interest) - Number(stored.total_interest)) > 0.005;

    let newMonthlyPayment: number;

    // Only touch the financial terms when something that actually determines
    // them changed. A timeline-only edit (e.g. backdating the start date) must
    // leave monthly_payment and total_interest exactly as they were recorded.
    const termsChanged = contractChanged || mpChanged || tiChanged;

    if (contractChanged) {
      // Rate / term / amount moved → rebuild the installment from the contract.
      newMonthlyPayment = calculateMonthlyPayment(newAmount, newRate, newTerm);
    } else if (mpChanged) {
      // The admin edited the installment directly.
      newMonthlyPayment = Number(updates.monthly_payment);
    } else if (tiChanged) {
      // The admin edited total interest directly → derive the installment from it.
      newMonthlyPayment =
        newTerm > 0 ? (newAmount + Number(updates.total_interest)) / newTerm : Number(stored.monthly_payment);
    } else {
      newMonthlyPayment = Number(stored.monthly_payment);
    }

    if (termsChanged) {
      newMonthlyPayment = round2(newMonthlyPayment);
      updatedData.monthly_payment = newMonthlyPayment;

      if (tiChanged && !contractChanged && !mpChanged) {
        // Honour the admin's explicit total interest exactly.
        updatedData.total_interest = round2(Number(updates.total_interest));
      } else {
        // Derive total interest from the repayment schedule itself (the same
        // declining-balance rules used when the loan was created), rather than
        // the flat `amount × rate × term` or the bare installment identity.
        updatedData.total_interest = computeScheduledTotalInterest(
          newAmount,
          newMonthlyPayment,
          newRate,
          newTerm
        );
      }
    }

    if (amountProvided) updatedData.amount = newAmount;
    if (rateProvided) updatedData.interest_rate = newRate;

    // ---- repayments / rollover state (admin corrections) ----
    if (updates.amount_paid !== undefined) updatedData.amount_paid = Number(updates.amount_paid);
    if (updates.rolled_balance !== undefined) updatedData.rolled_balance = Number(updates.rolled_balance);
    if (updates.compounded_interest !== undefined) {
      updatedData.compounded_interest = Number(updates.compounded_interest);
    }

    // ---- schedule: next_due_date ----
    if (updates.next_due_date !== undefined) {
      updatedData.next_due_date = parseLoanDate(updates.next_due_date, "next due date");
    } else if (startProvided || termProvided) {
      updatedData.next_due_date = await computeLoanNextDueDate(
        loanId,
        newStartDate,
        newTerm,
        stored.marked_payments
      );
    }

    updatedData.updated_at = new Date();

    const result = await prisma.loan.update({
      where: { id: loanId },
      data: updatedData,
    });

    // ---- append-only timeline/audit record (never rewrites history) ----
    const trackedFields = [
      "amount",
      "principal_balance",
      "interest_rate",
      "start_date",
      "end_date",
      "term_months",
      "monthly_payment",
      "total_interest",
      "amount_paid",
      "rolled_balance",
      "compounded_interest",
      "status",
      "next_due_date",
    ];

    const normalize = (value: any): any => {
      if (value === null || value === undefined) return null;
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "object" && typeof value.toNumber === "function") return Number(value);
      return value;
    };

    const before: Record<string, any> = {};
    const after: Record<string, any> = {};
    const changes: Record<string, { from: any; to: any }> = {};
    for (const field of trackedFields) {
      const oldValue = normalize(stored[field]);
      const newValue = Object.prototype.hasOwnProperty.call(updatedData, field)
        ? normalize(updatedData[field])
        : oldValue;
      before[field] = oldValue;
      after[field] = newValue;
      if (String(oldValue) !== String(newValue)) {
        changes[field] = { from: oldValue, to: newValue };
      }
    }

    const changeSummary =
      Object.entries(changes)
        .map(([field, value]) => `${field}: ${value.from} → ${value.to}`)
        .join(", ") || "no field changes";

    try {
      await ledgerService.logEvent(
        stored.user_id,
        loanId,
        "timeline_edit",
        `Loan financials edited by admin — ${changeSummary}`
      );
    } catch (ledgerError) {
      console.error("[LEDGER] Failed to log loan financial edit:", ledgerError);
    }

    try {
      await auditService.logAction({
        adminId: adminId || stored.user_id,
        targetUserId: stored.user_id,
        action: "loan_updated",
        oldValues: before,
        newValues: { ...after, changes },
      });
    } catch (auditError) {
      console.error("[AUDIT] Failed to log loan financial edit:", auditError);
    }

    return result;
  }

  // Contribution-deduction requests are stored in loan_payments (payment_method =
  // "contribution_deduction"); the legacy repayment_requests table is no longer
  // written by any code path. Query loan_payments so queued deductions show up in
  // the admin Requests queue, and attach the borrower profile for display.
  async getRepaymentRequests(loanId?: string, userId?: string) {
    try {
      const where: any = { payment_method: "contribution_deduction" };
      if (loanId) {
        where.loan_id = loanId;
      }
      if (userId) {
        where.user_id = userId;
      }

      const payments = await prisma.loan_payments.findMany({
        where,
        orderBy: { submitted_at: "desc" },
      });

      // Attach the borrower profile (loan_payments.user_id → user_profiles) so
      // the frontend can render the applicant name/email.
      const userIds = [...new Set(payments.map((p: any) => p.user_id))];
      const profiles = userIds.length
        ? await prisma.user_profiles.findMany({ where: { id: { in: userIds } } })
        : [];
      const profileMap = new Map(profiles.map((p: any) => [p.id, p]));

      const requests = payments.map((p: any) => ({
        ...p,
        user_profiles: profileMap.get(p.user_id) || null,
      }));

      console.log(`[REPAYMENT REQUESTS] Found ${requests.length} deduction requests for loanId=${loanId}, userId=${userId}`);
      return requests;
    } catch (error) {
      console.error("[REPAYMENT REQUESTS ERROR]", error);
      throw new AppError(500, "Failed to fetch repayment requests");
    }
  }
}

export default new LoanService();

export const loanService = new LoanService();
